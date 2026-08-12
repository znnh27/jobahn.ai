# job-tool

找工作 AI 助手，Phase 3 正式產品。技術選型與架構決策見 `../data/` 底下的設定檔（`workflow.json`、`resume_rules.json`）以及專案根目錄的建置計畫。

## 開發前要準備的東西

1. 一個 [Supabase](https://supabase.com) 專案
2. 一個 [Vercel](https://vercel.com) 帳號（部署用）
3. 一個 [Firecrawl](https://firecrawl.dev) API Key（抓職缺頁面用）

**不需要**申請系統共用的 Anthropic API Key，這個專案是純 BYOK 模式，每個使用者自己在 `/settings` 頁綁定自己的 Key。

## 本機設定步驟

1. 建立 Supabase 專案後，到 SQL Editor 依序執行：
   - `supabase/migrations/0001_init.sql`
   - `supabase/migrations/0002_storage.sql`
2. 複製 `.env.local.example` 成 `.env.local`，填入 Supabase 專案的 URL／anon key／service role key，以及 Firecrawl API Key
3. 安裝依賴並啟動開發伺服器：

   ```bash
   npm install
   npm run dev
   ```

4. 開啟 http://localhost:3000，會被導去 `/login`，可以先到 `/signup` 註冊測試帳號

## 目前進度

- [x] Next.js 專案骨架（TypeScript + Tailwind + App Router）
- [x] Supabase schema（profiles / user_settings / original_resumes / experience_entries / profile_data / resume_rules / applications）
- [x] Storage bucket（原始履歷上傳，限制 docx/pdf/doc、單檔 3MB）
- [x] 登入／註冊／登出（Supabase Auth）
- [ ] 設定頁：綁定 Anthropic API Key
- [ ] 首次設定流程：履歷上傳＋解析
- [ ] 核心迴圈：職缺輸入＋履歷生成畫布＋JD比對／ATS評分
- [ ] 求職信步驟
- [ ] 首頁：應徵紀錄表格
