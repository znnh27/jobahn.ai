-- 記錄每次呼叫 AI 的用量，純粹給自己事後查看/防呆用，
-- 不做任何硬性額度擋人，askClaude() 每次呼叫時用 service role 寫入一筆

create table if not exists public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,       -- 'local-cli' | 'api'
  feature text,                 -- 'resume_parse' | 'resume_generate' | 'ats_score' | 'cover_letter' 等
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(10,6),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_log_user_created_idx on public.ai_usage_log(user_id, created_at);
create index if not exists ai_usage_log_created_idx on public.ai_usage_log(created_at);

alter table public.ai_usage_log enable row level security;

-- 只給讀取自己的紀錄，寫入一律由後端用 service role key 執行（繞過 RLS），
-- 不開放 authenticated 角色自己 insert，避免使用者端偽造用量紀錄
create policy "ai_usage_log_select_own" on public.ai_usage_log
  for select using (auth.uid() = user_id);
