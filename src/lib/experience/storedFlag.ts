// 「檢查整份經歷資料庫」給的建議，連同當時的文字一起存在那一條寫法上（variant.flag）。
// 文字沒改過就直接沿用，不用再問 AI；重新整理頁面後建議也還在。
// 文字改過、或已經通過／被忽略（reviewedText 等於目前文字）就不算數。
// 伺服器（檢查時跳過）跟畫面（載入時顯示）共用。

export type StoredFlag = { text: string; suggestion: string; rewrite: string | null };

export function activeStoredFlag(v: { text: string; reviewedText?: string; flag?: StoredFlag }): StoredFlag | null {
  if (!v.flag || v.flag.text !== v.text) return null;
  if (typeof v.reviewedText === "string" && v.reviewedText === v.text) return null;
  return v.flag;
}
