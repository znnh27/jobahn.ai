-- 應徵紀錄的求職進度：投出去、面試 get、Offer get!（首頁表格的三個勾選框）。
-- 存勾選的時間而不只是有沒有勾，首頁上方的漏斗才算得出「投出去到面試平均幾天」。
-- 使用者可以改日期（例如上週就投了、今天才補勾）。沒勾是 null。

alter table public.applications
  add column if not exists submitted_at timestamptz,
  add column if not exists interview_at timestamptz,
  add column if not exists offer_at timestamptz;
