-- Eagle Eye 360 · ATLIP — migration 0003: move RLS helpers out of the exposed API schema
create schema if not exists app;
revoke all on schema app from public, anon;
grant usage on schema app to authenticated;

-- Policies reference functions by OID, so moving them keeps every policy intact.
alter function public.app_role() set schema app;
alter function public.has_role(text[]) set schema app;
alter function public.is_active_user() set schema app;
alter function public.chat_can_access(text) set schema app;

revoke execute on function app.app_role(), app.has_role(text[]), app.is_active_user(), app.chat_can_access(text) from public, anon;
grant execute on function app.app_role(), app.has_role(text[]), app.is_active_user(), app.chat_can_access(text) to authenticated;

create or replace function app.chat_can_access(p_thread text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and (
    p_thread = 'group:command'
    or (p_thread like 'dm:%' and auth.uid()::text = any(string_to_array(substr(p_thread, 4), ':'))))
$$;

create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active or new.email is distinct from old.email)
     and auth.uid() is not null and not app.has_role(array['super_admin','system_admin']) then
    raise exception 'Only administrators can change role, activation or email';
  end if;
  if new.role = 'super_admin' and old.role <> 'super_admin' and auth.uid() is not null and not app.has_role(array['super_admin']) then
    raise exception 'Only a super administrator can grant super administrator';
  end if;
  return new;
end $$;

create or replace function public.log_audit(p_action text, p_target text default null, p_category text default 'system')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_active_user() then raise exception 'not authorised'; end if;
  insert into public.audit_logs (actor_id, actor_name, category, action, target)
  select auth.uid(), coalesce(nullif(p.full_name,''), p.email), p_category, left(p_action, 500), left(p_target, 300)
  from public.profiles p where p.id = auth.uid();
end $$;

create or replace function public.designate_model(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(array['super_admin','system_admin','supervisor']) then raise exception 'not authorised'; end if;
  update public.ai_models set status = 'ARCHIVED', updated_at = now() where status = 'PRODUCTION';
  update public.ai_models set status = 'PRODUCTION', updated_at = now() where id = p_id and status <> 'DEMO ONLY';
  perform public.log_audit('Model designated as production', (select version from public.ai_models where id = p_id), 'model');
end $$;

-- Trigger functions are never called directly
revoke execute on function public.guard_profile_update(), public.comm_after_insert(), public.ticket_after_change(),
  public.handle_new_user(), public.evidence_hash(), public.ticket_set_resolved(), public.touch_updated_at()
  from public, anon, authenticated;
revoke execute on function public.log_audit(text,text,text), public.designate_model(bigint), public.heartbeat() from public, anon;
grant execute on function public.log_audit(text,text,text), public.designate_model(bigint), public.heartbeat() to authenticated;
