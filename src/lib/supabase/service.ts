import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// 用 service role key 建立的 client，繞過 RLS。只能在伺服器端使用（Server
// Action / Route Handler），絕對不能把 SUPABASE_SERVICE_ROLE_KEY 暴露到瀏覽器。
// 目前唯一用途：寫入 ai_usage_log（一般使用者沒有 insert 權限，只能讀自己的）。
export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
