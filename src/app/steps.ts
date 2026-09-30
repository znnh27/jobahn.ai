// 應徵流程的步驟編號（StepBar 用）。獨立一個檔案，伺服器端頁面才能直接呼叫。

export type StepIndex = 0 | 1 | 2 | 3;

/** 應徵狀態 → 已經走到第幾步（0 新增職缺、1 修改履歷、2 寫求職信、3 完成）。 */
export function reachedStepFromStatus(status: string | null | undefined): StepIndex {
  if (status === "completed") return 3;
  if (status === "resume_finalized") return 2;
  return 1;
}
