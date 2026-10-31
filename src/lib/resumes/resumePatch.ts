import type { GeneratedResume } from "./generateResume";

// 履歷頁「跟 AI 聊」只回傳改到的地方（2026-10-29 Z 反映聊天要等很久）。
// 以前每則訊息都要 AI 把整份履歷重寫一遍（2,300–5,200 tokens，約 50 tokens／秒，等 70 秒上下），
// 大部分訊息只改一兩條。改成 AI 回傳 ops，由程式套回去；改動很多、或要動到公司職稱這類結構時才回傳整份。
// 每條 bullet 給一個 id 讓 AI 指名，id 對不上就整份退回重寫，不猜。

type Resume = GeneratedResume["resume"];
type Section = "work_experience" | "leadership";

const PREFIX: Record<Section, string> = { work_experience: "w", leadership: "l" };

/** 給 AI 看的履歷：每段經歷、每條 bullet 都帶 id（例如 w0、w0-2），學歷、版面不給。 */
export function resumeForPatch(resume: Resume) {
  const withIds = (section: Section) =>
    (resume[section] ?? []).map((e, i) => ({
      id: `${PREFIX[section]}${i}`,
      org: e.org,
      role: e.role,
      period: e.period,
      location: e.location,
      bullets: (e.bullets ?? []).map((text, j) => ({ id: `${PREFIX[section]}${i}-${j}`, text })),
    }));
  return {
    summary: resume.summary,
    work_experience: withIds("work_experience"),
    leadership: withIds("leadership"),
    skills: resume.skills,
    languages: resume.languages,
  };
}

export const RESUME_PATCH_FORMAT = `輸出格式：{ "reply": string, "mode": "patch" | "full", "ops": op[], "resume": 整份履歷 | null, "remember": string[], "learned": learned[] }
- 預設用 patch：ops 只列出要改的地方，沒列到的程式會保持原樣，resume 給 null。上面履歷裡的 id 只是給你指名用的。
- op 有這幾種：
  { "op": "summary", "text": string }：改寫摘要
  { "op": "replace", "id": "w0-2", "text": string }：改寫這條 bullet
  { "op": "insert", "entry": "w0", "after": "w0-2" | null, "text": string }：在這段經歷新增一條，接在 after 那條後面；after 給 null 就放在第一條。同一個 after 新增好幾條，會照 ops 的順序往下排
  { "op": "delete", "id": "w0-2" }：刪掉這條
  { "op": "skills", "skills": string[] }：整組換掉技能
- 這幾種情況改用 full，resume 給整份履歷（格式跟系統說明裡的履歷 JSON 一樣，不要帶 id），ops 給空陣列：
  改動很多（例如整份語氣、全部改短、超過大概一半的 bullet）；
  要改公司、職稱、期間、地點，新增或拿掉整段經歷，或調整 bullet、經歷的順序。`;

export type ResumeOp =
  | { op: "summary"; text: string }
  | { op: "replace"; id: string; text: string }
  | { op: "insert"; entry: string; after: string | null; text: string }
  | { op: "delete"; id: string }
  | { op: "skills"; skills: string[] };

type Slot = { id: string | null; text: string; deleted?: boolean };

function parseEntryId(id: unknown): { section: Section; index: number } | null {
  const m = typeof id === "string" ? /^([wl])(\d+)$/.exec(id.trim()) : null;
  if (!m) return null;
  return { section: m[1] === "w" ? "work_experience" : "leadership", index: Number(m[2]) };
}

/** 把 ops 套到目前的履歷上，回傳新的一份（不改傳進來的那份）。有任何一個 op 看不懂、id 對不上，就回傳 null。 */
export function applyResumePatch(resume: Resume, ops: unknown): Resume | null {
  if (!Array.isArray(ops)) return null;

  // 每段經歷的 bullet 先變成可以插入、刪除的格子，原本的 bullet 帶 id，新增的沒有。
  const slots: Record<Section, Slot[][]> = {
    work_experience: (resume.work_experience ?? []).map((e, i) =>
      (e.bullets ?? []).map((text, j) => ({ id: `w${i}-${j}`, text })),
    ),
    leadership: (resume.leadership ?? []).map((e, i) =>
      (e.bullets ?? []).map((text, j) => ({ id: `l${i}-${j}`, text })),
    ),
  };
  const findBullet = (id: unknown) => {
    const m = typeof id === "string" ? /^([wl]\d+)-\d+$/.exec(id.trim()) : null;
    const entry = m ? parseEntryId(m[1]) : null;
    const list = entry ? slots[entry.section][entry.index] : undefined;
    const slot = list?.find((s) => s.id === (id as string).trim() && !s.deleted);
    return slot && list ? { list, slot } : null;
  };
  // 同一個 after 新增好幾條時，下一條接在上一條新增的後面，順序才會跟 ops 一樣。
  const lastInserted = new Map<string, Slot>();

  let summary = resume.summary;
  let skills = resume.skills;
  for (const raw of ops as Record<string, unknown>[]) {
    const text = typeof raw?.text === "string" ? raw.text.trim() : "";
    switch (raw?.op) {
      case "summary":
        if (!text) return null;
        summary = text;
        break;
      case "skills":
        if (!Array.isArray(raw.skills) || raw.skills.some((s) => typeof s !== "string")) return null;
        skills = raw.skills as string[];
        break;
      case "replace": {
        const found = findBullet(raw.id);
        if (!found || !text) return null;
        found.slot.text = text;
        break;
      }
      case "delete": {
        const found = findBullet(raw.id);
        if (!found) return null;
        found.slot.deleted = true;
        break;
      }
      case "insert": {
        const entry = parseEntryId(raw.entry);
        const list = entry ? slots[entry.section][entry.index] : undefined;
        if (!list || !text) return null;
        const key = `${raw.entry}:${raw.after ?? ""}`;
        const anchor = lastInserted.get(key) ?? (raw.after == null ? null : findBullet(raw.after)?.slot);
        if (raw.after != null && !anchor) return null;
        // after 要是同一段經歷裡的 bullet。
        if (anchor && !list.includes(anchor)) return null;
        const slot: Slot = { id: null, text };
        list.splice(anchor ? list.indexOf(anchor) + 1 : 0, 0, slot);
        lastInserted.set(key, slot);
        break;
      }
      default:
        return null;
    }
  }

  const rebuild = (section: Section) =>
    (resume[section] ?? []).map((e, i) => ({
      ...e,
      bullets: slots[section][i].filter((s) => !s.deleted).map((s) => s.text),
    }));
  return {
    ...resume,
    summary,
    skills: [...skills],
    work_experience: rebuild("work_experience"),
    leadership: rebuild("leadership"),
  };
}

/** AI 回傳整份履歷時的基本檢查：經歷是陣列、bullet 是字串（AI 偶爾會把上面帶 id 的格式照抄回來）。 */
export function isResumeShape(value: unknown): value is Resume {
  const r = value as Resume | null;
  const sectionOk = (list: unknown) =>
    Array.isArray(list) &&
    list.every(
      (e) => e && typeof e.org === "string" && Array.isArray(e.bullets) && e.bullets.every((b: unknown) => typeof b === "string"),
    );
  return !!r && typeof r.summary === "string" && sectionOk(r.work_experience) && sectionOk(r.leadership ?? []);
}
