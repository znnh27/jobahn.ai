-- JD 關鍵字（履歷頁「關鍵字命中」用）：招募官在 ATS 裡搜尋人才是逐字比對，
-- 所以另外列出 JD 裡的硬技能、工具、方法、領域用語、職稱，比對履歷有沒有用到同一個字。
-- 一份 JD 只請 AI 挑一次，存在這裡；比對本身在瀏覽器裡用程式算，改履歷就即時更新。

alter table public.applications
  add column if not exists jd_keywords text[];
