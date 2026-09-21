-- Phase 1（經歷資料庫重新設計）：把 description_variants 從「依來源檔案分組的扁平 bullet 清單」
-- 改成「依同一件事的不同寫法分組」的 achievements 結構。
--
-- 舊結構：description_variants = [{ source, bullets: [...], note }]
-- 新結構：achievements = [{ id, variants: [{ text, angle_label, source }] }]
--
-- 目前沒有需要保留的正式使用者資料（上線前的個人專案階段），直接 rename 欄位，
-- 不做資料轉換；欄位型別維持 jsonb，實際形狀由應用層（mergeIntoExperienceDb）保證。

alter table public.experience_entries
  rename column description_variants to achievements;

comment on column public.experience_entries.achievements is
  '[{ id, variants: [{ text, angle_label, source }] }]，同一件事的不同寫法分組在同一個 achievement 底下，只會新增不會刪除';
