-- 求職進度在「投出去了」跟「面試 get」中間多一關「回覆 get」：公司有任何回應就算
-- （HR 來信、電話初談、約時間），正式面試排定才算「面試 get」。一樣存勾選的時間，漏斗才算得出回覆率跟平均天數。

alter table public.applications
  add column if not exists replied_at timestamptz;
