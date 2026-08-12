-- Storage bucket 設定：原始履歷上傳
-- 檔案限制：僅 docx/pdf/doc，單檔 3MB（對應計畫書的防呆設計）
-- 注意：不建立任何存放「生成後 Word/PDF」的 bucket，
-- 因為設計上生成檔案是即時產生、傳完即丟，不落地存檔

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'original-resumes',
  'original-resumes',
  false, -- 不公開，需透過簽名網址存取
  3145728, -- 3MB
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', -- .docx
    'application/msword',                                                      -- .doc
    'application/pdf'                                                          -- .pdf
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 使用者只能存取自己資料夾底下的檔案（路徑規則：{user_id}/{filename}）
create policy "original_resumes_storage_select_own"
on storage.objects for select
using (bucket_id = 'original-resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "original_resumes_storage_insert_own"
on storage.objects for insert
with check (bucket_id = 'original-resumes' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "original_resumes_storage_delete_own"
on storage.objects for delete
using (bucket_id = 'original-resumes' and (storage.foldername(name))[1] = auth.uid()::text);
