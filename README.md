# jobahn

找工作 AI 助手，Phase 3 正式產品。技術選型與架構決策見 `../data/` 底下的設定檔（`workflow.json`、`resume_rules.json`）以及專案根目錄的建置計畫。

## 開發前要準備的東西

1. 一個 [Supabase](https://supabase.com) 專案
2. 一個 [Vercel](https://vercel.com) 帳號（部署用）
3. 一個 [Firecrawl](https://firecrawl.dev) API Key（抓職缺頁面用）

Anthropic API 呼叫走雙模式（見 `.env.local.example` 的 `AI_PROVIDER` 說明）：本機開發預設用你自己的 Claude Pro/Max 訂閱（透過已登入的 Claude Code CLI，不用申請 API Key），部署到 Vercel 後才需要切成 API 模式並填入共用的 `ANTHROPIC_API_KEY`。`/settings` 頁的 API Key 綁定是選填功能，使用者不綁也能直接用（走共用額度），不是強制 BYOK。

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
- [x] 設定頁：選填綁定自己的 Anthropic API Key（Supabase Vault 加密存放，含金鑰有效性驗證），不綁定則使用共用額度
- [ ] `askClaude()` 共用函式：雙模式（本機 Claude Code CLI／正式環境 API），所有 AI 功能都透過這個函式呼叫
- [ ] 首次設定流程：履歷上傳＋解析
- [ ] 核心迴圈：職缺輸入＋履歷生成畫布＋JD比對／ATS評分
- [ ] 求職信步驟
- [ ] 首頁：應徵紀錄表格
