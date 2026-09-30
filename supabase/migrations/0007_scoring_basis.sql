-- ATS 評分要一致：記下「上次評分時的內容」，內容沒改就直接沿用上次結果，不再呼叫 AI。
-- score_basis 結構：
--   { "resume": { "en": <評分時的履歷>, "zh": ... },
--     "cover_letter": { "en": <比對時的求職信文字>, "zh": ... } }
-- cover_letter_checklist：求職信頁的 JD 條件對照（履歷＋求職信合起來）。以前跟履歷頁共用
-- jd_match_checklist，求職信補上的項目回到履歷頁也會被打勾，現在分開存。

alter table public.applications
  add column if not exists score_basis jsonb,
  add column if not exists cover_letter_checklist jsonb;
