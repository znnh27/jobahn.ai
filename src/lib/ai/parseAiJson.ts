import { askClaude, type AskClaudeParams, type AskClaudeResult } from "./askClaude";

// AI 回傳的 JSON 全系統都經過這一支讀（2026-10-30 求職信「跟 AI 聊」偶爾跳「不是有效的 JSON」）。
// 以前各處自己 JSON.parse，格式一壞就整個失敗。常見的壞法先修好再讀：
// - 前後多了說明文字、包了 ```json
// - 字串裡直接換行（信、段落），沒有寫成 \n
// - 字串裡引用一句話用了沒跳脫的半形引號，例如 "reply": "加了一句"如果需要…""
// - 最後一個元素後面多一個逗號
// 修不好就把原文印在終端機（之後才查得到是哪種壞法），再丟錯誤。

export class AiJsonError extends Error {}

/** 讀 AI 回傳的 JSON。格式壞掉先試著修，修不好丟 AiJsonError。 */
export function parseAiJson<T = unknown>(text: string, label = "ai"): T {
  const body = extractJson(text);
  try {
    return JSON.parse(body) as T;
  } catch {
    // 往下修
  }
  try {
    const parsed = JSON.parse(repairJson(body)) as T;
    console.warn(`[parseAiJson] ${label}：格式有誤，已自動修好`);
    return parsed;
  } catch {
    console.error(`[parseAiJson] ${label}：格式修不好，AI 原文：\n${text.slice(0, 3000)}`);
    throw new AiJsonError("AI 回傳的內容不是有效的 JSON");
  }
}

/**
 * 呼叫 AI 並讀 JSON；修不好就再問一次（多等一次的時間，但不用使用者自己重送）。
 * 給「跟 AI 聊」用：使用者在等回覆，跳錯誤要他重打一次最傷。
 */
export async function askClaudeForJson<T = unknown>(
  params: AskClaudeParams,
): Promise<{ data: T; response: AskClaudeResult }> {
  for (let attempt = 0; ; attempt++) {
    const response = await askClaude(params);
    try {
      return { data: parseAiJson<T>(response.text, params.feature), response };
    } catch (e) {
      if (attempt >= 1 || !(e instanceof AiJsonError)) throw e;
      console.warn(`[parseAiJson] ${params.feature}：重新問一次`);
    }
  }
}

/** 去掉 code fence、前後的說明文字，只留第一個 { 或 [ 到最後一個對應的 } 或 ]。 */
function extractJson(text: string): string {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = t.search(/[{[]/);
  if (start < 0) return t;
  const end = t.lastIndexOf(t[start] === "{" ? "}" : "]");
  return end > start ? t.slice(start, end + 1) : t.slice(start);
}

/**
 * 一個字一個字走過去，分辨在字串裡面還是外面：
 * 字串裡的換行、tab 跳脫掉；字串裡的半形引號，後面接的不是 , : } ]（不是字串的結尾）就當成內容跳脫掉；
 * 字串外面 } ] 前多的逗號拿掉。
 */
export function repairJson(s: string): string {
  let out = "";
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (!inString) {
      if (c === '"') inString = true;
      else if (c === "}" || c === "]") out = out.replace(/,\s*$/, "");
      out += c;
      continue;
    }
    if (c === "\\") {
      out += c + (s[i + 1] ?? "");
      i++;
    } else if (c === '"') {
      const next = /^\s*(.)/.exec(s.slice(i + 1))?.[1];
      if (next === undefined || ",:}]".includes(next)) {
        inString = false;
        out += c;
      } else {
        out += '\\"';
      }
    } else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else if (c.charCodeAt(0) < 0x20) out += " ";
    else out += c;
  }
  return out;
}
