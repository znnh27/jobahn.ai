-- 把 Anthropic API Key 的加解密操作包成 security definer function，
-- 讓一般使用者（anon/authenticated role）可以透過 RPC 呼叫，
-- 而不需要直接開放 vault schema 的存取權限

-- 設定／更新自己的 Anthropic API Key
create or replace function public.set_user_anthropic_key(p_key text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_secret_id uuid;
  v_new_secret_id uuid;
  v_last4 text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if length(p_key) < 8 then
    raise exception 'key 格式不正確';
  end if;

  v_last4 := right(p_key, 4);

  select anthropic_key_secret_id into v_existing_secret_id
  from public.user_settings
  where user_id = v_user_id;

  if v_existing_secret_id is not null then
    perform vault.update_secret(v_existing_secret_id, p_key);
    update public.user_settings
      set anthropic_key_last4 = v_last4, updated_at = now()
      where user_id = v_user_id;
  else
    v_new_secret_id := vault.create_secret(p_key, 'anthropic_key_' || v_user_id::text);
    insert into public.user_settings (user_id, anthropic_key_secret_id, anthropic_key_last4)
    values (v_user_id, v_new_secret_id, v_last4)
    on conflict (user_id) do update
      set anthropic_key_secret_id = excluded.anthropic_key_secret_id,
          anthropic_key_last4 = excluded.anthropic_key_last4,
          updated_at = now();
  end if;
end;
$$;

-- 拿回自己的 Anthropic API Key 明碼（只給後端在使用者自己的 session 底下呼叫，
-- 用來打 Claude API；function 內用 auth.uid() 保證只能拿到自己的 key）
create or replace function public.get_user_anthropic_key()
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_user_id uuid := auth.uid();
  v_secret_id uuid;
  v_key text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select anthropic_key_secret_id into v_secret_id
  from public.user_settings
  where user_id = v_user_id;

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where id = v_secret_id;

  return v_key;
end;
$$;

-- 移除自己綁定的 key
create or replace function public.remove_user_anthropic_key()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_user_id uuid := auth.uid();
  v_secret_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select anthropic_key_secret_id into v_secret_id
  from public.user_settings
  where user_id = v_user_id;

  if v_secret_id is not null then
    delete from vault.secrets where id = v_secret_id;
  end if;

  update public.user_settings
    set anthropic_key_secret_id = null, anthropic_key_last4 = null, updated_at = now()
    where user_id = v_user_id;
end;
$$;

revoke all on function public.set_user_anthropic_key(text) from public;
revoke all on function public.get_user_anthropic_key() from public;
revoke all on function public.remove_user_anthropic_key() from public;
grant execute on function public.set_user_anthropic_key(text) to authenticated;
grant execute on function public.get_user_anthropic_key() to authenticated;
grant execute on function public.remove_user_anthropic_key() to authenticated;
