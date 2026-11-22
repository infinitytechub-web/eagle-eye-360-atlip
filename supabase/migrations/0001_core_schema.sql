-- Eagle Eye 360 · ATLIP — migration 0001: core schema, roles, RLS
-- Least-privilege by default: every table has RLS; every policy requires an ACTIVE profile.

create extension if not exists pgcrypto with schema extensions;

-- ============ ROLES & PROFILES ============
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'auditor' check (role in (
    'super_admin','system_admin','supervisor','analyst','operator','support_officer','auditor')),
  command text not null default '',
  active boolean not null default false,
  theme text not null default 'dark' check (theme in ('dark','light')),
  prefs jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function public.has_role(roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = any(roles))
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active)
$$;

-- Role groups
-- admins: super_admin, system_admin
-- command: admins + supervisor
-- writers (anyone except read-only auditor)

create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

create trigger profiles_touch before update on public.profiles
for each row execute function public.touch_updated_at();

-- New auth user -> profile. The very first account becomes an ACTIVE super_admin (bootstrap);
-- every later self-registration is an INACTIVE auditor until an administrator approves it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare first_user boolean;
begin
  select not exists (select 1 from public.profiles where role = 'super_admin') into first_user;
  insert into public.profiles (id, email, full_name, role, active, command)
  values (
    new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)),
    case when first_user then 'super_admin' else 'auditor' end,
    first_user,
    case when first_user then 'National Command HQ' else '' end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();

-- Users may edit their own name/theme/prefs only; role/active/email changes need an administrator.
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.role is distinct from old.role or new.active is distinct from old.active or new.email is distinct from old.email)
     and not public.has_role(array['super_admin','system_admin']) then
    raise exception 'Only administrators can change role, activation or email';
  end if;
  if new.role = 'super_admin' and old.role <> 'super_admin' and not public.has_role(array['super_admin']) then
    raise exception 'Only a super administrator can grant super administrator';
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
for each row execute function public.guard_profile_update();

alter table public.profiles enable row level security;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.has_role(array['super_admin','system_admin']))
  with check (public.has_role(array['super_admin','system_admin']));

-- ============ AUDIT ============
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',
  category text not null default 'system' check (category in ('system','auth','camera','evidence','admin','branding','support','comms','detection','model','security')),
  action text not null,
  target text,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (created_at desc);
create index on public.audit_logs (category, created_at desc);
alter table public.audit_logs enable row level security;
create policy audit_read on public.audit_logs for select to authenticated
  using (public.has_role(array['super_admin','system_admin','supervisor','auditor'])
         or (actor_id = auth.uid() and public.is_active_user())
         or (category in ('camera','evidence') and public.is_active_user()));
-- no direct insert/update/delete: append-only via log_audit()

create or replace function public.log_audit(p_action text, p_target text default null, p_category text default 'system')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_user() then raise exception 'not authorised'; end if;
  insert into public.audit_logs (actor_id, actor_name, category, action, target)
  select auth.uid(), coalesce(nullif(p.full_name,''), p.email), p_category, left(p_action, 500), left(p_target, 300)
  from public.profiles p where p.id = auth.uid();
end $$;

-- ============ INTERSECTIONS & CAMERAS ============
create table public.intersections (
  id text primary key,
  name text not null,
  city text not null,
  lat double precision not null,
  lon double precision not null,
  map_x int not null default 0,
  map_y int not null default 0,
  current_state text not null default 'UNKNOWN' check (current_state in ('RED','CAUTION','GREEN','UNKNOWN')),
  created_at timestamptz not null default now()
);
alter table public.intersections enable row level security;
create policy ix_read on public.intersections for select to authenticated using (public.is_active_user());
create policy ix_write on public.intersections for all to authenticated
  using (public.has_role(array['super_admin','system_admin','supervisor']))
  with check (public.has_role(array['super_admin','system_admin','supervisor']));

create sequence public.camera_seq start 1;
create table public.cameras (
  id text primary key default ('CAM-' || lpad(nextval('public.camera_seq')::text, 2, '0')),
  name text not null check (length(name) between 3 and 120),
  intersection_id text not null references public.intersections(id),
  gateway_ref text not null check (gateway_ref !~* '(rtsp|rtmp|https?://|password|passwd|@)' and length(gateway_ref) <= 60),
  credential_vault_id text, -- reference into the video-gateway vault; never a credential
  status text not null default 'Online' check (status in ('Online','Offline','Obstructed')),
  retention_days int not null default 14 check (retention_days in (7,14,30)),
  events_count int not null default 0,
  obstruction_count int not null default 0,
  registered_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
alter table public.cameras enable row level security;
create policy cam_read on public.cameras for select to authenticated using (public.is_active_user());
create policy cam_insert on public.cameras for insert to authenticated
  with check (public.has_role(array['super_admin','system_admin','supervisor','operator','support_officer']));
create policy cam_update on public.cameras for update to authenticated
  using (public.has_role(array['super_admin','system_admin','supervisor','operator','support_officer']))
  with check (public.has_role(array['super_admin','system_admin','supervisor','operator','support_officer']));
create policy cam_delete on public.cameras for delete to authenticated
  using (public.has_role(array['super_admin','system_admin']));

-- ============ DETECTIONS ============
create table public.detection_events (
  id bigint generated always as identity primary key,
  intersection_id text references public.intersections(id),
  camera_id text references public.cameras(id) on delete set null,
  state text not null check (state in ('RED','CAUTION','GREEN','UNKNOWN')),
  detail text, -- e.g. GREEN_ARROW_LEFT, PEDESTRIAN
  confidence numeric(4,3) check (confidence between 0 and 1),
  verified boolean not null default false,
  source text not null default 'seed' check (source in ('seed','demo-scene','mobile-heuristic','gateway','model')),
  user_id uuid references public.profiles(id) on delete set null,
  lat double precision, lon double precision,
  created_at timestamptz not null default now()
);
create index on public.detection_events (created_at desc);
create index on public.detection_events (intersection_id, created_at desc);
alter table public.detection_events enable row level security;
create policy det_read on public.detection_events for select to authenticated using (public.is_active_user());
create policy det_insert on public.detection_events for insert to authenticated
  with check (user_id = auth.uid() and source in ('demo-scene','mobile-heuristic')
              and public.has_role(array['super_admin','system_admin','supervisor','analyst','operator','support_officer']));

-- ============ ALERTS ============
create table public.alerts (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('signal','camera','lowconf','obstructed','ai','security')),
  severity text not null check (severity in ('r','a','g')),
  body text not null,
  acknowledged_by uuid references public.profiles(id),
  acknowledged_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.alerts (created_at desc);
alter table public.alerts enable row level security;
create policy alert_read on public.alerts for select to authenticated using (public.is_active_user());
create policy alert_insert on public.alerts for insert to authenticated
  with check (created_by = auth.uid() and public.has_role(array['super_admin','system_admin','supervisor','analyst','operator']));
create policy alert_ack on public.alerts for update to authenticated
  using (public.has_role(array['super_admin','system_admin','supervisor','analyst','operator']))
  with check (public.has_role(array['super_admin','system_admin','supervisor','analyst','operator']));

-- ============ EVIDENCE (real SHA-256 computed in the database) ============
create table public.evidence_records (
  id bigint generated always as identity primary key,
  ref text unique not null,
  event_id bigint references public.detection_events(id) on delete set null,
  intersection_id text references public.intersections(id),
  state text not null check (state in ('RED','CAUTION','GREEN','UNKNOWN')),
  notes text,
  sha256 text not null default '',
  retention_until date not null default (current_date + 90),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create or replace function public.evidence_hash() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.sha256 := encode(extensions.digest(
    concat_ws('|', new.ref, new.intersection_id, new.state, coalesce(new.event_id::text,''), coalesce(new.notes,''), new.created_at::text),
    'sha256'), 'hex');
  return new;
end $$;
create trigger evidence_hash_trg before insert or update on public.evidence_records
for each row execute function public.evidence_hash();
alter table public.evidence_records enable row level security;
create policy ev_read on public.evidence_records for select to authenticated using (public.is_active_user());
create policy ev_insert on public.evidence_records for insert to authenticated
  with check (public.has_role(array['super_admin','system_admin','supervisor','analyst']));
create policy ev_delete on public.evidence_records for delete to authenticated
  using (public.has_role(array['super_admin','supervisor']));

-- ============ AI MODELS ============
create table public.ai_models (
  id bigint generated always as identity primary key,
  version text unique not null,
  dataset_ref text not null,
  evaluation text not null,
  status text not null check (status in ('STAGED','PRODUCTION','ARCHIVED','DEMO ONLY')),
  updated_at timestamptz not null default now()
);
alter table public.ai_models enable row level security;
create policy model_read on public.ai_models for select to authenticated using (public.is_active_user());
create policy model_write on public.ai_models for update to authenticated
  using (public.has_role(array['super_admin','system_admin','supervisor']))
  with check (public.has_role(array['super_admin','system_admin','supervisor']));

create or replace function public.designate_model(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(array['super_admin','system_admin','supervisor']) then raise exception 'not authorised'; end if;
  update public.ai_models set status = 'ARCHIVED', updated_at = now() where status = 'PRODUCTION';
  update public.ai_models set status = 'PRODUCTION', updated_at = now() where id = p_id and status <> 'DEMO ONLY';
  perform public.log_audit('Model designated as production', (select version from public.ai_models where id = p_id), 'model');
end $$;

-- ============ NOTIFICATIONS ============
create table public.notifications (
  id bigint generated always as identity primary key,
  type text not null check (type in ('system','security','announcement','support','activity')),
  priority text not null check (priority in ('Low','Medium','High','Critical')),
  title text not null check (length(title) <= 160),
  body text not null check (length(body) <= 2000),
  target_type text not null default 'all' check (target_type in ('all','user','role')),
  target text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index on public.notifications (created_at desc);
create table public.notification_reads (
  notification_id bigint references public.notifications(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);
alter table public.notifications enable row level security;
alter table public.notification_reads enable row level security;
create policy notif_read on public.notifications for select to authenticated using (
  public.is_active_user() and (
    target_type = 'all' or (target_type = 'user' and target = auth.uid()::text)
    or (target_type = 'role' and target = public.app_role())));
create policy notif_insert on public.notifications for insert to authenticated
  with check (created_by = auth.uid() and public.has_role(array['super_admin','system_admin','supervisor']));
create policy nread_own on public.notification_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_active_user());

create or replace function public.notify(p_type text, p_prio text, p_title text, p_body text, p_target_type text default 'all', p_target text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.notifications where title = p_title and created_at > now() - interval '5 minutes') then return; end if;
  insert into public.notifications (type, priority, title, body, target_type, target, created_by)
  values (p_type, p_prio, left(p_title,160), left(p_body,2000), p_target_type, p_target, auth.uid());
end $$;
revoke execute on function public.notify(text,text,text,text,text,text) from public, anon, authenticated;

-- ============ LIVE CHAT ============
-- thread_key: 'group:command' or 'dm:<uuid-lo>:<uuid-hi>'
create or replace function public.chat_can_access(p_thread text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and (
    p_thread = 'group:command'
    or (p_thread like 'dm:%' and auth.uid()::text = any(string_to_array(substr(p_thread, 4), ':'))))
$$;
create table public.chat_messages (
  id bigint generated always as identity primary key,
  thread_key text not null check (thread_key = 'group:command' or thread_key ~ '^dm:[0-9a-f-]{36}:[0-9a-f-]{36}$'),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  file_path text, file_name text, file_size int,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.chat_messages (thread_key, created_at);
alter table public.chat_messages enable row level security;
create policy chat_read on public.chat_messages for select to authenticated using (public.chat_can_access(thread_key));
create policy chat_insert on public.chat_messages for insert to authenticated
  with check (sender_id = auth.uid() and public.chat_can_access(thread_key));
create policy chat_mark_read on public.chat_messages for update to authenticated
  using (public.chat_can_access(thread_key) and sender_id <> auth.uid())
  with check (public.chat_can_access(thread_key));

-- ============ COMMUNICATION CENTRE ============
create table public.comm_messages (
  id bigint generated always as identity primary key,
  channel text not null check (channel in ('announce','accra','kumasi','security','itsupport')),
  sender_id uuid references public.profiles(id) on delete set null,
  sender_name text not null default '',
  body text not null check (length(body) between 1 and 4000),
  priority text not null default 'Normal' check (priority in ('Normal','Priority','Emergency')),
  file_path text, file_name text, file_size int,
  created_at timestamptz not null default now()
);
create index on public.comm_messages (created_at desc);
create table public.comm_receipts (
  message_id bigint references public.comm_messages(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  acked_at timestamptz,
  primary key (message_id, user_id)
);
alter table public.comm_messages enable row level security;
alter table public.comm_receipts enable row level security;
create policy comm_read on public.comm_messages for select to authenticated using (public.is_active_user());
create policy comm_insert on public.comm_messages for insert to authenticated with check (
  sender_id = auth.uid() and public.is_active_user()
  and public.app_role() <> 'auditor'
  and ((channel <> 'announce' and priority <> 'Emergency') or public.has_role(array['super_admin','system_admin','supervisor'])));
create policy rcpt_read on public.comm_receipts for select to authenticated using (public.is_active_user());
create policy rcpt_write on public.comm_receipts for insert to authenticated with check (user_id = auth.uid() and public.is_active_user());
create policy rcpt_update on public.comm_receipts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.comm_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.channel = 'announce' then
    perform public.notify('announcement','High','Broadcast: Announcements — All Staff', new.body);
    perform public.log_audit('Broadcast posted to Announcements channel', null, 'comms');
  end if;
  if new.priority = 'Emergency' then
    perform public.notify('system','Critical','EMERGENCY — ' || new.channel, new.body);
    perform public.log_audit('Emergency communication posted', new.channel, 'comms');
  end if;
  return new;
end $$;
create trigger comm_after_insert_trg after insert on public.comm_messages
for each row execute function public.comm_after_insert();

-- ============ IT HELP & SUPPORT ============
create sequence public.ticket_seq start 1048;
create table public.tickets (
  id bigint generated always as identity primary key,
  ref text unique not null default ('EE-SUP-' || nextval('public.ticket_seq')),
  title text not null check (length(title) between 4 and 160),
  category text not null check (category in ('Technical Support','Account Access','System Errors','Security Incidents','General Enquiries')),
  priority text not null check (priority in ('Low','Medium','High','Critical')),
  status text not null default 'Open' check (status in ('Open','Assigned','In Progress','Pending','Resolved','Closed')),
  department text not null check (department in ('IT Operations','Security Operations','Network & CCTV','Access Management')),
  requester_id uuid references public.profiles(id) on delete set null,
  requester_name text not null default '',
  assignee text not null default 'Unassigned',
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- duplicates prevented in the database, not just the UI
create unique index tickets_open_title_uniq on public.tickets (lower(title)) where status not in ('Resolved','Closed');
create trigger tickets_touch before update on public.tickets for each row execute function public.touch_updated_at();
create table public.ticket_events (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.tickets(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  author_name text not null default '',
  body text not null check (length(body) between 1 and 4000),
  internal boolean not null default false,
  file_path text, file_name text, file_size int,
  created_at timestamptz not null default now()
);
create index on public.ticket_events (ticket_id, created_at);
alter table public.tickets enable row level security;
alter table public.ticket_events enable row level security;
create policy tk_read on public.tickets for select to authenticated using (public.is_active_user());
create policy tk_insert on public.tickets for insert to authenticated
  with check (requester_id = auth.uid() and public.is_active_user() and public.app_role() <> 'auditor');
create policy tk_update on public.tickets for update to authenticated
  using (public.has_role(array['super_admin','system_admin','supervisor','support_officer']))
  with check (public.has_role(array['super_admin','system_admin','supervisor','support_officer']));
create policy tke_read on public.ticket_events for select to authenticated using (
  public.is_active_user() and (not internal or public.has_role(array['super_admin','system_admin','supervisor','support_officer'])));
create policy tke_insert on public.ticket_events for insert to authenticated with check (
  author_id = auth.uid() and public.is_active_user() and public.app_role() <> 'auditor'
  and (not internal or public.has_role(array['super_admin','system_admin','supervisor','support_officer'])));

create or replace function public.ticket_after_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.notify('support', case when new.priority = 'Critical' then 'Critical' else 'Medium' end,
      'New support ticket ' || new.ref, new.title);
    perform public.log_audit('Support ticket created: ' || new.ref, new.category || ', ' || new.priority, 'support');
  elsif new.status is distinct from old.status or new.priority is distinct from old.priority or new.assignee is distinct from old.assignee then
    if new.requester_id is not null then
      perform public.notify('support', 'Medium', 'Ticket ' || new.ref || ' — ' || new.status, new.title, 'user', new.requester_id::text);
    end if;
    perform public.log_audit('Ticket ' || new.ref || ' updated', old.status || ' → ' || new.status || ' · ' || new.priority || ' · ' || new.assignee, 'support');
  end if;
  return new;
end $$;
create trigger ticket_after_change_trg after insert or update on public.tickets
for each row execute function public.ticket_after_change();

create or replace function public.ticket_set_resolved() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status in ('Resolved','Closed') and new.resolved_at is null then new.resolved_at := now(); end if;
  if new.status not in ('Resolved','Closed') then new.resolved_at := null; end if;
  return new;
end $$;
create trigger ticket_resolved_trg before insert or update on public.tickets
for each row execute function public.ticket_set_resolved();

-- ============ BRANDING ============
create table public.branding (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table public.branding_versions (
  id bigint generated always as identity primary key,
  data jsonb not null,
  published_by uuid references public.profiles(id) on delete set null,
  published_by_name text not null default '',
  note text,
  created_at timestamptz not null default now()
);
alter table public.branding enable row level security;
alter table public.branding_versions enable row level security;
-- branding is public so the login page can show it before sign-in
create policy brand_read on public.branding for select to anon, authenticated using (true);
create policy brand_write on public.branding for update to authenticated
  using (public.has_role(array['super_admin'])) with check (public.has_role(array['super_admin']));
create policy bver_read on public.branding_versions for select to authenticated using (public.has_role(array['super_admin']));
create policy bver_insert on public.branding_versions for insert to authenticated
  with check (published_by = auth.uid() and public.has_role(array['super_admin']));

-- ============ PRESENCE / HEARTBEAT ============
create or replace function public.heartbeat() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set last_seen_at = now() where id = auth.uid();
$$;

-- Revoke the default PUBLIC execute and grant only what clients need
revoke execute on function public.log_audit(text,text,text) from public, anon;
revoke execute on function public.designate_model(bigint) from public, anon;
revoke execute on function public.heartbeat() from public, anon;
grant execute on function public.log_audit(text,text,text) to authenticated;
grant execute on function public.designate_model(bigint) to authenticated;
grant execute on function public.heartbeat() to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
