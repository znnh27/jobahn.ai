-- 求職信的字數上限：生成時填的、或在「跟 AI 聊」講的「縮到 2000 字」，記下來之後
-- 「再短一點」照這個上限縮、補充完超過會提醒、字數顯示成「共 1942／2000 字」。
-- 格式：{ [語言]: 字數 }，字數跟求職網站一樣算字元（不含聯絡方式那一行）。
-- 沒跑這個 migration 也能寫求職信，只是上限不會記住，重新整理就沒了。

alter table public.applications
  add column if not exists cover_letter_word_limits jsonb;
