/** 上傳結果訊息的尾巴：從另一個語言補上了多少（中英文經歷資料庫要同步）。沒補就是空字串。 */
export function parityNote(result: { parityEntriesAdded?: number; parityAchievementsAdded?: number }): string {
  const entries = result.parityEntriesAdded ?? 0;
  const achievements = result.parityAchievementsAdded ?? 0;
  if (!entries && !achievements) return "";
  return `；另一個語言同步補上 ${entries ? `${entries} 段經歷、` : ""}${achievements} 個成就`;
}
