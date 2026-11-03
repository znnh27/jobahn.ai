import type { GeneratedResume } from "./generateResume";

// AI 回傳的履歷是照「送出當下」那份改的。等 AI 的期間使用者可能又改了別的地方，
// 整份換上去會把那些修改蓋掉（2026-11-04 Z 回報：等 AI 時改的字，AI 跑完全部恢復原狀）。
// 這裡拿三份比：送出當下（base）、使用者現在的（ours）、AI 改好的（theirs），一格一格合併：
// 只有一邊改的用那一邊；兩邊都改了同一格就留使用者的，AI 的結果可以再問一次，使用者打的字不行。

type Resume = GeneratedResume["resume"];
type Entry = Resume["work_experience"][number];

export function mergeResumeEdits(base: Resume, ours: Resume, theirs: Resume): { resume: Resume; conflicts: number } {
  let conflicts = 0;
  const key = (v: unknown) => JSON.stringify(v ?? null);

  function pick<T>(b: T, o: T, t: T): T {
    if (key(o) === key(b)) return t;
    if (key(t) === key(b) || key(t) === key(o)) return o;
    conflicts++;
    return o;
  }

  // 筆數三邊都一樣才逐筆比；有一邊增刪過，就只能整組看是誰動的（兩邊都動了就留使用者的）。
  function list<T>(b: T[], o: T[], t: T[], item: (b: T, o: T, t: T) => T): T[] {
    if (key(o) === key(b)) return t;
    if (key(t) === key(b)) return o;
    if (b.length === o.length && b.length === t.length) return b.map((x, i) => item(x, o[i], t[i]));
    return pick(b, o, t);
  }

  const entry = (b: Entry, o: Entry, t: Entry): Entry => ({
    ...o,
    org: pick(b.org, o.org, t.org),
    role: pick(b.role, o.role, t.role),
    period: pick(b.period, o.period, t.period),
    location: pick(b.location, o.location, t.location),
    bullets: list(b.bullets ?? [], o.bullets ?? [], t.bullets ?? [], pick),
  });

  const resume: Resume = {
    ...ours,
    summary: pick(base.summary, ours.summary, theirs.summary),
    work_experience: list(base.work_experience ?? [], ours.work_experience ?? [], theirs.work_experience ?? [], entry),
    leadership: list(base.leadership ?? [], ours.leadership ?? [], theirs.leadership ?? [], entry),
    education: pick(base.education, ours.education, theirs.education),
    skills: pick(base.skills, ours.skills, theirs.skills),
    languages: pick(base.languages, ours.languages, theirs.languages),
    layout: ours.layout,
  };
  return { resume, conflicts };
}
