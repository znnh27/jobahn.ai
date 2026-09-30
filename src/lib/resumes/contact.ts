// 履歷抬頭（姓名＋聯絡資訊）的共用型別跟格式。畫布、Word、PDF、求職信署名都用這一份，
// 顯示格式才會一致。存在 profile_data.data.contact。
// 格式參考：
//   Chen, Wei-Ting (Alex Chen)
//   E-mail: xxx / Phone Number: xxx / LinkedIn: xxx / Portfolio: xxx

export interface ResumeContactExtra {
  label: string;
  value: string;
}

export interface ResumeContact {
  name_zh: string | null;
  name_en: string | null;
  email: string | null;
  phone: string | null;
  linkedin: string | null;
  portfolio: string | null;
  /** 其他自訂欄位，例如 GitHub、Behance、個人網站。 */
  others?: ResumeContactExtra[];
}

export const EMPTY_CONTACT: ResumeContact = {
  name_zh: null,
  name_en: null,
  email: null,
  phone: null,
  linkedin: null,
  portfolio: null,
  others: [],
};

const FIELD_LABELS: Record<string, { email: string; phone: string; linkedin: string; portfolio: string }> = {
  en: { email: "E-mail", phone: "Phone Number", linkedin: "LinkedIn", portfolio: "Portfolio" },
  zh: { email: "Email", phone: "電話", linkedin: "LinkedIn", portfolio: "作品集" },
};

/** 依履歷語言挑名字：中文履歷優先用中文名，英文履歷優先用英文名，沒有就用另一個。 */
export function pickName(contact: ResumeContact, language: string): string {
  const primary = language === "zh" ? contact.name_zh : contact.name_en;
  return (primary || contact.name_zh || contact.name_en || "").trim();
}

/** 聯絡資訊拆成「標籤＋內容」，讓各種輸出格式都能把標籤設成粗體。 */
export function contactParts(contact: ResumeContact, language: string): ResumeContactExtra[] {
  const labels = FIELD_LABELS[language] ?? FIELD_LABELS.en;
  const parts: ResumeContactExtra[] = [];
  if (contact.email) parts.push({ label: labels.email, value: contact.email });
  if (contact.phone) parts.push({ label: labels.phone, value: contact.phone });
  if (contact.linkedin) parts.push({ label: labels.linkedin, value: contact.linkedin });
  if (contact.portfolio) parts.push({ label: labels.portfolio, value: contact.portfolio });
  for (const extra of contact.others ?? []) {
    if (extra.label.trim() && extra.value.trim()) parts.push({ label: extra.label.trim(), value: extra.value.trim() });
  }
  return parts;
}

export const CONTACT_SEPARATOR = " / ";

/** 純文字版（沒辦法設粗體的地方用）。 */
export function buildContactLine(contact: ResumeContact, language: string): string {
  return contactParts(contact, language)
    .map((p) => `${p.label}: ${p.value}`)
    .join(CONTACT_SEPARATOR);
}

/** 至少要有一個名字跟 Email，履歷才算有抬頭。 */
export function hasRequiredContact(contact: ResumeContact | null | undefined): boolean {
  return !!contact && !!(contact.name_zh?.trim() || contact.name_en?.trim()) && !!contact.email?.trim();
}

/** 從 profile_data.data 讀出 contact，缺的欄位補 null。 */
export function readContact(profileData: unknown): ResumeContact {
  const raw = (profileData as { contact?: Partial<ResumeContact> } | null)?.contact ?? {};
  return {
    ...EMPTY_CONTACT,
    ...raw,
    others: Array.isArray(raw.others) ? raw.others : [],
  };
}
