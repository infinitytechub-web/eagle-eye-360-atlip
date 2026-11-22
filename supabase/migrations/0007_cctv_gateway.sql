-- Eagle Eye 360 · ATLIP — migration 0007: CCTV video gateway
-- The gateway runs on the camera network and signs in as a dedicated, least-privilege 'gateway' account.

-- 1) gateway role
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in (
  'super_admin','system_admin','supervisor','analyst','operator','support_officer','auditor','gateway'));

create or replace function app.can_view_cctv() returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role(array['super_admin','system_admin','supervisor','analyst','operator','support_officer'])
$$;
revoke execute on function app.can_view_cctv() from public, anon;
grant execute on function app.can_view_cctv() to authenticated;

-- 2) gateways registry
create table public.gateways (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text not null,
  public_url text not null check (public_url ~ '^https://'),
  account_id uuid references public.profiles(id) on delete set null,  -- the gateway service account
  status text not null default 'unknown' check (status in ('online','offline','unknown')),
  version text,
  info jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.gateways enable row level security;
create policy gw_read on public.gateways for select to authenticated using (app.is_active_user());
create policy gw_admin on public.gateways for all to authenticated
  using (app.has_role(array['super_admin','system_admin'])) with check (app.has_role(array['super_admin','system_admin']));
create policy gw_self_update on public.gateways for update to authenticated
  using (account_id = auth.uid() and app.has_role(array['gateway']))
  with check (account_id = auth.uid() and app.has_role(array['gateway']));

-- 3) camera ↔ gateway
alter table public.cameras
  add column gateway_id text references public.gateways(id) on delete set null,
  add column stream_enabled boolean not null default false,
  add column ai_enabled boolean not null default true,
  add column last_frame_at timestamptz,
  add column stream_info jsonb not null default '{}'::jsonb;

create or replace function app.is_gateway_for(p_gateway text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.has_role(array['gateway']) and exists (select 1 from public.gateways g where g.id = p_gateway and g.account_id = auth.uid())
$$;
revoke execute on function app.is_gateway_for(text) from public, anon;
grant execute on function app.is_gateway_for(text) to authenticated;

-- a gateway may update ONLY health fields of its own cameras (enforced by trigger below)
create policy cam_gateway_update on public.cameras for update to authenticated
  using (app.is_gateway_for(gateway_id)) with check (app.is_gateway_for(gateway_id));

create or replace function public.guard_camera_gateway_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.has_role(array['gateway']) then
    if new.name is distinct from old.name or new.intersection_id is distinct from old.intersection_id
       or new.gateway_ref is distinct from old.gateway_ref or new.gateway_id is distinct from old.gateway_id
       or new.stream_enabled is distinct from old.stream_enabled or new.ai_enabled is distinct from old.ai_enabled
       or new.retention_days is distinct from old.retention_days or new.credential_vault_id is distinct from old.credential_vault_id then
      raise exception 'Gateway accounts may only update camera health fields';
    end if;
  end if;
  return new;
end $$;
create trigger cameras_gateway_guard before update on public.cameras
for each row execute function public.guard_camera_gateway_update();
revoke execute on function public.guard_camera_gateway_update() from public, anon, authenticated;

-- 4) gateway writes: detections, alerts, intersection state
create policy det_gateway_insert on public.detection_events for insert to authenticated
  with check (source = 'gateway' and user_id = auth.uid()
              and exists (select 1 from public.cameras c where c.id = detection_events.camera_id and app.is_gateway_for(c.gateway_id)));
create policy alert_gateway_insert on public.alerts for insert to authenticated
  with check (created_by = auth.uid() and app.has_role(array['gateway']) and kind in ('camera','obstructed','ai','signal'));
create policy ix_gateway_update on public.intersections for update to authenticated
  using (app.has_role(array['gateway']) and exists (select 1 from public.cameras c where c.intersection_id = intersections.id and app.is_gateway_for(c.gateway_id)))
  with check (app.has_role(array['gateway']));

create or replace function public.guard_intersection_gateway_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if app.has_role(array['gateway']) and (new.name is distinct from old.name or new.city is distinct from old.city
     or new.lat is distinct from old.lat or new.lon is distinct from old.lon or new.map_x is distinct from old.map_x or new.map_y is distinct from old.map_y) then
    raise exception 'Gateway accounts may only update the observed signal state';
  end if;
  return new;
end $$;
create trigger intersections_gateway_guard before update on public.intersections
for each row execute function public.guard_intersection_gateway_update();
revoke execute on function public.guard_intersection_gateway_update() from public, anon, authenticated;

-- 5) CCTV viewing sessions (oversight: who watched which camera, when)
create table public.cctv_sessions (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  user_name text not null default '',
  camera_id text references public.cameras(id) on delete set null,
  gateway_id text references public.gateways(id) on delete set null,
  client text,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index on public.cctv_sessions (started_at desc);
alter table public.cctv_sessions enable row level security;
create policy cs_read on public.cctv_sessions for select to authenticated
  using (app.has_role(array['super_admin','system_admin','supervisor','auditor']) or user_id = auth.uid()
         or exists (select 1 from public.gateways g where g.id = gateway_id and g.account_id = auth.uid()));
create policy cs_gateway_insert on public.cctv_sessions for insert to authenticated
  with check (app.is_gateway_for(gateway_id));
create policy cs_gateway_update on public.cctv_sessions for update to authenticated
  using (app.is_gateway_for(gateway_id)) with check (app.is_gateway_for(gateway_id));

-- 6) gateway-authored audit entries (on behalf of the viewer it authorised)
create or replace function public.gateway_audit(p_actor uuid, p_actor_name text, p_action text, p_target text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.has_role(array['gateway']) then raise exception 'not authorised'; end if;
  insert into public.audit_logs (actor_id, actor_name, category, action, target)
  values (p_actor, left(coalesce(p_actor_name,''),120), 'camera', left(p_action,500), left(p_target,300));
end $$;
revoke execute on function public.gateway_audit(uuid,text,text,text) from public, anon;
grant execute on function public.gateway_audit(uuid,text,text,text) to authenticated;

-- 7) the gateway account is a machine identity: no messaging, tickets or chat
create or replace function app.chat_can_access(p_thread text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_active_user() and coalesce(app.app_role(), '') <> 'gateway' and (
    p_thread = 'group:command'
    or (p_thread like 'dm:%' and auth.uid()::text = any(string_to_array(substr(p_thread, 4), ':'))))
$$;
drop policy comm_insert on public.comm_messages;
create policy comm_insert on public.comm_messages for insert to authenticated with check (
  sender_id = auth.uid() and app.is_active_user() and app.app_role() not in ('auditor','gateway')
  and ((channel <> 'announce' and priority <> 'Emergency') or app.has_role(array['super_admin','system_admin','supervisor'])));
drop policy tk_insert on public.tickets;
create policy tk_insert on public.tickets for insert to authenticated
  with check (requester_id = auth.uid() and app.is_active_user() and app.app_role() not in ('auditor','gateway'));
drop policy tke_insert on public.ticket_events;
create policy tke_insert on public.ticket_events for insert to authenticated with check (
  author_id = auth.uid() and app.is_active_user() and app.app_role() not in ('auditor','gateway')
  and (not internal or app.has_role(array['super_admin','system_admin','supervisor','support_officer'])));

alter publication supabase_realtime add table public.gateways, public.cctv_sessions;
