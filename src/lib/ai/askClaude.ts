import "server-only";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

// 雙模式共用函式：所有需要 AI 的功能（履歷解析、JD 比對生成、ATS 評分、求職信）
// 都只能透過這個函式呼叫 Claude，不要在別的地方直接 new Anthropic() 或 spawn claude CLI。
//
// AI_PROVIDER=local-cli：本機開發用，透過已登入 Pro/Max 的 Claude Code CLI（headless）呼叫，
//                        不用 API Key，用訂閱額度。只能在本機執行，Vercel 上無法使用。
// AI_PROVIDER=api      ：正式環境用，直接打 Messages API。優先用呼叫者自己在 /settings 綁定的
//                        Key（如果有給 supabase client 且有綁），否則退回共用的 ANTHROPIC_API_KEY。

const MODEL = "claude-sonnet-5";
const DEFAULT_MAX_TOKENS = 8000;
// Sonnet 5 標準價，用於 api 模式估算成本寫進 ai_usage_log（local-cli 模式直接讀 CLI 回報的 total_cost_usd）
const SONNET5_INPUT_PRICE_PER_MTOK = 3;
const SONNET5_OUTPUT_PRICE_PER_MTOK = 15;

export interface AskClaudeParams {
  userId: string;
  /** 供 ai_usage_log 分類用，例如 'resume_parse' | 'resume_generate' | 'ats_score' | 'cover_letter' */
  feature: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  /**
   * 只有 api 模式支援（SDK 直接透傳給 Messages API）。像評分/比對這種需要每次判斷盡量一致的
   * 任務建議設 0，降低同一份內容重複評分卻跑出不同結果的機率。local-cli 模式（headless CLI）
   * 沒有對應參數可以控制，這個欄位在該模式下會被忽略。
   */
  temperature?: number;
  /** 使用者自己的已登入 Supabase client，api 模式會用它查詢使用者是否綁定了自己的 Key */
  supabase?: SupabaseClient;
  /**
   * 只有 local-cli 模式用：CLI 的思考強度。沒指定就用 medium。
   * 一定要明確指定，不然 CLI 會沿用使用者自己 Claude Code 的設定（例如 high），
   * 生成一份履歷會多想好幾倍的時間（實測 high 106 秒、medium 41 秒，結果幾乎一樣；low 會出現時態錯誤）。
   */
  effort?: "low" | "medium" | "high";
}

export interface AskClaudeResult {
  text: string;
  provider: "local-cli" | "api";
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
}

export async function askClaude(params: AskClaudeParams): Promise<AskClaudeResult> {
  const provider = process.env.AI_PROVIDER === "api" ? "api" : "local-cli";

  const startedAt = Date.now();
  const result =
    provider === "local-cli" ? await callLocalCli(params) : await callApi(params);

  // 開發時看每一步 AI 花多少時間（生成履歷會連續呼叫好幾次，慢的時候從這裡找是哪一步）。
  if (process.env.NODE_ENV !== "production") {
    console.info(
      `[askClaude] ${params.feature} ${((Date.now() - startedAt) / 1000).toFixed(1)}s` +
        ` in=${result.inputTokens} out=${result.outputTokens}`,
    );
  }

  await logUsage(params.userId, params.feature, result);

  return result;
}

async function callLocalCli(params: AskClaudeParams): Promise<AskClaudeResult> {
  const args = [
    "--print",
    "--output-format",
    "json",
    "--model",
    MODEL,
    "--tools",
    "",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--strict-mcp-config",
    "--system-prompt",
    params.systemPrompt,
    "--max-budget-usd",
    "2",
    "--effort",
    params.effort ?? "medium",
  ];

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn("claude", args, {
      cwd: tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => reject(new Error(`無法啟動 claude CLI：${e.message}`)));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI 結束碼 ${code}：${err || out}`));
      } else {
        resolve(out);
      }
    });

    child.stdin.write(params.userPrompt);
    child.stdin.end();
  });

  const parsed = JSON.parse(stdout);

  if (parsed.is_error) {
    throw new Error(`claude CLI 回傳錯誤：${parsed.result ?? "未知錯誤"}`);
  }

  return {
    text: String(parsed.result ?? ""),
    provider: "local-cli",
    inputTokens: parsed.usage?.input_tokens ?? 0,
    outputTokens: parsed.usage?.output_tokens ?? 0,
    estimatedCostUsd:
      typeof parsed.total_cost_usd === "number" ? parsed.total_cost_usd : null,
  };
}

async function callApi(params: AskClaudeParams): Promise<AskClaudeResult> {
  const maxTokens = params.maxTokens ?? DEFAULT_MAX_TOKENS;

  let apiKey = process.env.ANTHROPIC_API_KEY;

  if (params.supabase) {
    const { data } = await params.supabase.rpc("get_user_anthropic_key");
    if (typeof data === "string" && data.length > 0) {
      apiKey = data;
    }
  }

  if (!apiKey) {
    throw new Error(
      "沒有可用的 Anthropic API Key（共用 ANTHROPIC_API_KEY 未設定，使用者也沒有自己綁定）",
    );
  }

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: params.systemPrompt,
    messages: [{ role: "user", content: params.userPrompt }],
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
  });

  const textBlock = response.content.find((b) => b.type === "text");

  return {
    text: textBlock?.type === "text" ? textBlock.text : "",
    provider: "api",
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    estimatedCostUsd: estimateCostUsd(response.usage.input_tokens, response.usage.output_tokens),
  };
}

function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * SONNET5_INPUT_PRICE_PER_MTOK +
    (outputTokens / 1_000_000) * SONNET5_OUTPUT_PRICE_PER_MTOK
  );
}

async function logUsage(
  userId: string,
  feature: string,
  result: AskClaudeResult,
): Promise<void> {
  try {
    const service = createServiceClient();
    await service.from("ai_usage_log").insert({
      user_id: userId,
      provider: result.provider,
      feature,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      estimated_cost_usd: result.estimatedCostUsd,
    });
  } catch {
    // 記錄用量失敗不該讓生成流程掛掉，安靜失敗即可
  }
}
