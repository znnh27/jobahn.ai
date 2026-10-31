import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { askClaude } from "@/lib/ai/askClaude";
import { parseAiJson } from "@/lib/ai/parseAiJson";
import { normalizeJd } from "./jdChecklist";

// JD 關鍵字：招募官在 ATS 裡搜尋人才是逐字比對，JD 寫 stakeholder management，
// 履歷寫「跨部門溝通」就搜不到。這裡從 JD 挑出會被拿來搜尋的字（硬技能、工具、方法、領域用語、職稱），
// 生成履歷、跟 AI 聊改履歷時給 AI，有對應事實就用 JD 原字寫。
// 畫面上不顯示關鍵字（2026-10-27 Z 拿掉「JD 關鍵字」區塊跟「一鍵換成 JD 用字」，覺得跟 JD 條件打架）。
//
// 一份應徵只挑一次（存在 applications.jd_keywords）；同一位使用者貼了一字不差的 JD，直接沿用上次挑的。

const SYSTEM_PROMPT = `你負責從 JD 挑出「招募官會拿來搜尋履歷的關鍵字」。招募官在 ATS 裡是逐字搜尋，所以要挑 JD 原文裡實際出現的字。

規則：
1. 一律照 JD 原文的寫法（大小寫、中英文都照抄），不翻譯、不換同義詞、不自己造詞。
2. 只從講工作內容、職責、資格條件、加分條件的段落挑。福利待遇、薪資、公司介紹、團隊文化、應徵方式這些段落整段跳過，裡面的字就算是英文專有名詞也不挑（例如 Stock Options、員工認股、年終獎金、彈性工時、遠端工作、團體保險、教育訓練補助）。
3. 每個字都先問自己：這個字是在講「這份工作要做什麼、要會什麼」嗎？不是就不挑。
4. 挑這幾類：硬技能（例如 SQL、A/B Testing、財務分析）、工具與軟體（例如 Figma、Jira、Excel）、方法與框架（例如 Scrum、OKR、PRD）、領域用語（例如 行動支付、B2B SaaS、KYC）、職稱（JD 的職缺名稱本身）。
5. 不挑：軟實力跟人格特質（溝通能力、細心、抗壓性、熱情）、太通用的字（經驗、能力、團隊、產品、專案、客戶）、學歷年資（大學以上、3 年以上）、公司名稱、福利。
6. 同一個概念只挑一次，用 JD 裡最完整的那個寫法。
7. 依重要性排序，JD 越強調（出現在必備條件、出現好幾次）的越前面。最多 20 個；JD 很短就少挑，不要湊數。

只輸出 JSON，不要其他文字、不要 markdown code fence：
{ "keywords": string[] }`;

/**
 * 這份應徵的 JD 關鍵字。
 * 1. 已經挑過 → 沿用。
 * 2. 同一位使用者有別的應徵貼了一字不差的 JD，而且挑過 → 沿用那份。
 * 3. 都沒有才請 AI 挑，存進這筆應徵。
 */
export async function resolveJdKeywords(params: {
  supabase: SupabaseClient;
  userId: string;
  applicationId: string;
  jd: string;
  stored: string[] | null | undefined;
}): Promise<string[]> {
  const { supabase, userId, applicationId, jd } = params;
  if (params.stored && params.stored.length > 0) return params.stored;

  let keywords: string[] | null = null;
  const { data: others } = await supabase
    .from("applications")
    .select("job_description, jd_keywords")
    .eq("user_id", userId)
    .neq("id", applicationId)
    .not("jd_keywords", "is", null);
  const target = normalizeJd(jd);
  for (const other of others ?? []) {
    if (normalizeJd(other.job_description ?? "") === target && other.jd_keywords?.length) {
      keywords = other.jd_keywords;
      break;
    }
  }

  if (!keywords) keywords = await extractKeywords(supabase, userId, jd);

  await supabase.from("applications").update({ jd_keywords: keywords }).eq("id", applicationId).eq("user_id", userId);
  return keywords;
}

async function extractKeywords(supabase: SupabaseClient, userId: string, jd: string): Promise<string[]> {
  const response = await askClaude({
    userId,
    feature: "jd_keywords",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: `===== JD =====\n${jd}`,
    maxTokens: 1000,
    temperature: 0,
    supabase,
  });
  let parsed: { keywords?: unknown };
  try {
    parsed = parseAiJson(response.text, "jdKeywords");
  } catch {
    throw new Error("AI 挑 JD 關鍵字時回傳的內容不是有效的 JSON");
  }
  const seen = new Set<string>();
  const keywords: string[] = [];
  for (const raw of Array.isArray(parsed.keywords) ? parsed.keywords : []) {
    const word = String(raw ?? "").trim();
    const key = word.toLowerCase();
    // 只留 JD 裡真的找得到的字（AI 偶爾會自己改寫或翻譯），比對時不分大小寫。
    if (!word || seen.has(key) || !jd.toLowerCase().includes(key)) continue;
    seen.add(key);
    keywords.push(word);
  }
  return keywords.slice(0, 20);
}
