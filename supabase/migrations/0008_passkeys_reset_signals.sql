-- Eagle Eye 360 · ATLIP — migration 0008: passkeys, admin password reset with forced MFA re-enrolment, traffic signals

-- ============ 1) PASSKEYS (WebAuthn) ============
create table public.user_passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  credential_id text unique not null,          -- base64url
  public_key text not null,                    -- base64url COSE key
  counter bigint not null default 0,
  transports text[] not null default '{}',
  device_type text,                            -- singleDevice | multiDevice
  backed_up boolean not null default false,
  name text not null default 'Passkey' check (length(name) <= 60),
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index on public.user_passkeys (user_id);
alter table public.user_passkeys enable row level security;
-- users see/rename/remove their own; administrators can see (not use) others for support; creation only via the passkey edge function
create policy pk_read on public.user_passkeys for select to authenticated
  using (user_id = auth.uid() or app.has_role(array['super_admin','system_admin']));
create policy pk_rename on public.user_passkeys for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy pk_delete on public.user_passkeys for delete to authenticated
  using (user_id = auth.uid() or app.has_role(array['super_admin']));

create table public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  challenge text not null,
  kind text not null check (kind in ('register','login')),
  expires_at timestamptz not null default now() + interval '5 minutes',
  created_at timestamptz not null default now()
);
alter table public.webauthn_challenges enable row level security;  -- no policies: edge function (service role) only

-- ============ 2) ADMIN PASSWORD RESET → FORCED PASSWORD CHANGE + MFA RE-ENROLMENT ============
alter table public.profiles
  add column password_change_required boolean not null default false,
  add column mfa_reenroll_required boolean not null default false,
  add column credentials_reset_at timestamptz;

create table public.credential_resets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  password_hash_snapshot text not null,  -- hash of the admin-issued temporary password (to verify it was changed)
  reset_by uuid references public.profiles(id) on delete set null,
  reset_at timestamptz not null default now()
);
alter table public.credential_resets enable row level security; -- no policies: definer functions only

-- users in a pending reset are NOT active for any data access until both steps are complete (server-side enforcement)
create or replace function app.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active
                 and not p.password_change_required and not p.mfa_reenroll_required)
$$;
create or replace function app.has_role(roles text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = any(roles)
                 and not p.password_change_required and not p.mfa_reenroll_required)
$$;
create or replace function app.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
    and not p.password_change_required and not p.mfa_reenroll_required
$$;

-- users cannot clear their own reset flags directly; only the completion functions below may (via a transaction-local flag)
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('app.credential_flow', true), '') = 'on' then return new; end if;
  if (new.role is distinct from old.role or new.active is distinct from old.active or new.email is distinct from old.email)
     and auth.uid() is not null and not app.has_role(array['super_admin','system_admin']) then
    raise exception 'Only administrators can change role, activation or email';
  end if;
  if new.role = 'super_admin' and old.role <> 'super_admin' and auth.uid() is not null and not app.has_role(array['super_admin']) then
    raise exception 'Only a super administrator can grant super administrator';
  end if;
  if (new.password_change_required is distinct from old.password_change_required or new.mfa_reenroll_required is distinct from old.mfa_reenroll_required
      or new.credentials_reset_at is distinct from old.credentials_reset_at) and auth.uid() is not null then
    raise exception 'Credential reset state can only be changed by the reset workflow';
  end if;
  return new;
end $$;
revoke execute on function public.guard_profile_update() from public, anon, authenticated;

-- called ONLY by the admin-users edge function (service role) after it sets the temporary password
create or replace function public.admin_credentials_reset(p_user uuid, p_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.credential_resets (user_id, password_hash_snapshot, reset_by, reset_at)
  select u.id, u.encrypted_password, p_by, now() from auth.users u where u.id = p_user
  on conflict (user_id) do update set password_hash_snapshot = excluded.password_hash_snapshot, reset_by = excluded.reset_by, reset_at = now();
  delete from auth.mfa_factors where user_id = p_user;          -- old authenticator no longer valid
  delete from auth.sessions where user_id = p_user;             -- sign out everywhere (refresh tokens cascade)
  delete from public.user_passkeys where user_id = p_user;      -- passkeys revoked; user re-registers after recovery
  perform set_config('app.credential_flow', 'on', true);
  update public.profiles set password_change_required = true, mfa_reenroll_required = true, credentials_reset_at = now() where id = p_user;
end $$;
revoke execute on function public.admin_credentials_reset(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_credentials_reset(uuid, uuid) to service_role;

-- step 1: the user has set a NEW password (verified by comparing the stored hash with the temporary one)
create or replace function public.complete_password_change() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare snap text; cur text;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and password_change_required) then return jsonb_build_object('ok', true); end if;
  select password_hash_snapshot into snap from public.credential_resets where user_id = auth.uid();
  select encrypted_password into cur from auth.users where id = auth.uid();
  if snap is not null and cur = snap then raise exception 'Choose a new password — the temporary password is still in use'; end if;
  perform set_config('app.credential_flow', 'on', true);
  update public.profiles set password_change_required = false where id = auth.uid();
  insert into public.audit_logs (actor_id, actor_name, category, action) select id, coalesce(nullif(full_name,''), email), 'auth', 'Temporary password replaced after administrator reset' from public.profiles where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- step 2: a NEW authenticator has been verified in this session (AAL2, factor created after the reset)
create or replace function public.complete_mfa_reenrolment() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare reset_at timestamptz;
begin
  select credentials_reset_at into reset_at from public.profiles where id = auth.uid() and mfa_reenroll_required;
  if not found then return jsonb_build_object('ok', true); end if;
  if exists (select 1 from public.profiles where id = auth.uid() and password_change_required) then raise exception 'Set a new password first'; end if;
  if coalesce(auth.jwt()->>'aal', '') <> 'aal2' then raise exception 'Verify your new authenticator code first'; end if;
  if not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified' and f.created_at > reset_at) then
    raise exception 'No authenticator enrolled since the reset';
  end if;
  perform set_config('app.credential_flow', 'on', true);
  update public.profiles set mfa_reenroll_required = false where id = auth.uid();
  delete from public.credential_resets where user_id = auth.uid();
  insert into public.audit_logs (actor_id, actor_name, category, action) select id, coalesce(nullif(full_name,''), email), 'auth', 'MFA authenticator re-enrolled after administrator reset' from public.profiles where id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.complete_password_change(), public.complete_mfa_reenrolment() from public, anon;
grant execute on function public.complete_password_change(), public.complete_mfa_reenrolment() to authenticated;

-- ============ 3) TRAFFIC SIGNAL LOCATIONS (for voice alerts) ============
create table public.traffic_signals (
  id bigint generated always as identity primary key,
  osm_id bigint unique,
  lat double precision not null check (lat between -90 and 90),
  lon double precision not null check (lon between -180 and 180),
  name text,
  source text not null check (source in ('osm','intersection','manual')),
  intersection_id text references public.intersections(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.traffic_signals (lat, lon);
alter table public.traffic_signals enable row level security;
create policy ts_read on public.traffic_signals for select to authenticated using (app.is_active_user());
create policy ts_insert on public.traffic_signals for insert to authenticated
  with check (source = 'manual' and created_by = auth.uid() and app.has_role(array['super_admin','system_admin','supervisor','operator']));
create policy ts_delete on public.traffic_signals for delete to authenticated
  using (app.has_role(array['super_admin','system_admin','supervisor']));

insert into public.traffic_signals (lat, lon, name, source, intersection_id)
select lat, lon, name, 'intersection', id from public.intersections;
