-- Phase 6（經歷資料庫重新設計收尾）：整個 app 已經沒有任何地方會寫入
-- original_resumes 這張表或 original-resumes 這個 Storage bucket 了——
-- 首次設定跟經歷資料庫頁面的上傳，現在都是「解析完就丟棄」，不落地存檔。
--
-- 這個 migration 會刪掉這張表跟這個 bucket，包含裡面現有的資料。
-- 這裡面存的只是「上傳過的原始檔案」中繼資料/二進位檔，不是解析出來的內容——
-- 真正有價值的經歷內容早就已經另外寫進 experience_entries 了，不會因為這個
-- migration 遺失。執行前你自己帳號如果還有測試上傳的殘留檔案，也會一併清掉。

drop policy if exists "original_resumes_storage_select_own" on storage.objects;
drop policy if exists "original_resumes_storage_insert_own" on storage.objects;
drop policy if exists "original_resumes_storage_delete_own" on storage.objects;

delete from storage.objects where bucket_id = 'original-resumes';
delete from storage.buckets where id = 'original-resumes';

drop table if exists public.original_resumes;
