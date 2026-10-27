-- 「校稿」的紀錄：每一格（履歷的摘要、bullet，求職信的段落）上次檢查的內容跟結果，沒改過就沿用，
-- 同一份內容連按兩次結果一樣；按過「略過」的建議記下來，之後不再出現。
-- 格式：{ "resume" | "letter": { [語言]: { basis, checked: { [那一格的文字]: 建議[] }, dismissed: string[] } } }
-- 沒跑這個 migration 也能校稿，只是每次都重新檢查、略過的會再出現。

alter table public.applications
  add column if not exists proofread jsonb;
