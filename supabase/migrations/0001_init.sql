-- jobahn Phase 3 初始 schema
-- 在 Supabase 專案建立後，到 SQL Editor 貼上整份檔案執行一次即可

-- 需要 Vault 擴充功能來加密存放使用者自己的 Anthropic API Key
create extension if not exists supabase_vault;

-- =========================================================
-- profiles：對應 auth.users，存基本顯示資訊
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

-- 新使用者註冊時自動建立 profile
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name');
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =========================================================
-- user_settings：只存 Vault 密鑰的參照 id，不存明碼 key
-- 純 BYOK：anthropic_key_secret_id 為 null 時，該使用者無法觸發任何生成動作
-- =========================================================
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  anthropic_key_secret_id uuid, -- 對應 vault.secrets.id
  anthropic_key_last4 text,     -- 只存末 4 碼供介面顯示「已綁定 ****1234」
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

create policy "user_settings_all_own" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- original_resumes：首次設定上傳的原始履歷檔案「中繼資料」
-- 實際二進位檔案存在 Supabase Storage 的 original-resumes bucket
-- =========================================================
create table if not exists public.original_resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  storage_path text not null,
  file_size_bytes integer not null,
  language text, -- 'zh' | 'en' | null（未判斷）
  uploaded_at timestamptz not null default now()
);

alter table public.original_resumes enable row level security;

create policy "original_resumes_all_own" on public.original_resumes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- experience_entries：經歷資料庫，每個使用者自己的一份
-- 對應 jobahn/data/experience_db.json 的「公司/組織 -> 描述變體」結構
-- =========================================================
create table if not exists public.experience_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  language text not null,          -- 'zh' | 'en'
  entry_type text not null,        -- 'work' | 'leadership'
  org_name text not null,          -- 公司/組織名稱
  location text,
  role_variants jsonb not null default '[]'::jsonb,
  period_variants jsonb not null default '[]'::jsonb,
  description_variants jsonb not null default '[]'::jsonb, -- [{source, bullets: [...]，note}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists experience_entries_user_idx on public.experience_entries(user_id);

alter table public.experience_entries enable row level security;

create policy "experience_entries_all_own" on public.experience_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- profile_data：聯絡資訊、學歷、技能清單、Professional Summary 變體
-- 每人一列
-- =========================================================
create table if not exists public.profile_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profile_data enable row level security;

create policy "profile_data_all_own" on public.profile_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- resume_rules：寫作規則設定檔，使用者可在介面上編輯
-- user_id 為 null 代表系統預設值（新使用者複製這份當起點）
-- =========================================================
create table if not exists public.resume_rules (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rules jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.resume_rules enable row level security;

create policy "resume_rules_all_own" on public.resume_rules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =========================================================
-- applications：每次應徵一筆紀錄，含定案快照
-- 履歷/求職信的「定案快照」跟 experience_entries 分開存，
-- 避免經歷資料庫之後被編輯導致舊履歷下載內容對不上
-- =========================================================
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_name text,
  job_title text,
  job_source_url text,
  job_description text,
  status text not null default 'draft', -- 'draft' | 'resume_finalized' | 'completed'

  -- 履歷生成/迴圈狀態
  resume_language text[],           -- ['en'] | ['zh'] | ['en','zh']
  resume_draft jsonb,                -- 目前畫布內容（編輯中）
  resume_snapshot jsonb,             -- 定案後的完整快照（含公司/bullet/順序/summary版本）
  jd_match_checklist jsonb,          -- [{item, covered, source: 'resume'|'cover_letter'|null}]
  ats_score integer,
  ats_gaps jsonb,

  -- 求職信
  cover_letter_language text[],
  cover_letter_draft jsonb,
  cover_letter_snapshot text,

  created_at timestamptz not null default now(),
  resume_finalized_at timestamptz,
  completed_at timestamptz
);

create index if not exists applications_user_idx on public.applications(user_id);

alter table public.applications enable row level security;

create policy "applications_all_own" on public.applications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
