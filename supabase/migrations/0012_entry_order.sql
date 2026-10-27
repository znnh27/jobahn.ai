-- 經歷資料庫的順序：經歷旁邊的 ↑↓ 可以調整同一區（正式工作／社團專案）裡的先後，中英文版一起移。
-- 沒調過的是 null，照建立時間排在後面。只影響經歷資料庫頁怎麼顯示；生成履歷時正式工作照時間、專案照 JD 相關度排。

alter table public.experience_entries
  add column if not exists sort_order integer;
