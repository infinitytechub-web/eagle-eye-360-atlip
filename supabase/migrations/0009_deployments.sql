-- Eagle Eye 360 · ATLIP — persistent production deployment record and automatic version identifiers.
--
-- Version format: V + DDMMYYYY (deployment date, Africa/Accra = GMT) + NNNN (daily counter from 0001).
-- A row is written ONLY after a deployment has been verified live (edge function `deployments`, called by the
-- GitHub Actions verification job with a GitHub OIDC token). Failed or cancelled deployments never get a row,
-- so the identifier shown in the app (looked up by the build that is actually live) never changes for them.
--
-- Duplicate prevention:
--   * record_deployment() takes a transaction-scoped advisory lock per environment, so concurrent calls are serialised;
--   * UNIQUE (environment, build_id)          — repeated/retried calls for the same build return the same identifier;
--   * UNIQUE (environment, deploy_date, seq)  — no two releases share a counter on the same day;
--   * UNIQUE (environment, version_id)        — no two releases share an identifier.
-- environment = 'test' is used only by the automated counter tests and never shown in the app.

create table if not exists public.deployments (
  id           bigserial primary key,
  environment  text        not null default 'production' check (environment in ('production', 'test')),
  deploy_date  date        not null,
  seq          integer     not null check (seq between 1 and 9999),
  version_id   text        not null check (version_id ~ '^V[0-9]{8}[0-9]{4}$'),
  build_id     text        not null check (build_id ~ '^[0-9]{1,20}-[0-9]{1,4}$|^test-[A-Za-z0-9_-]{1,60}$'),
  commit_sha   text        not null check (commit_sha ~ '^[0-9a-f]{7,40}$'),
  run_url      text        check (run_url is null or run_url ~ '^https://github\.com/infinitytechub-web/eagle-eye-360-atlip/actions/runs/[0-9]+'),
  verified_at  timestamptz not null default now(),
  constraint deployments_build_unique   unique (environment, build_id),
  constraint deployments_seq_unique     unique (environment, deploy_date, seq),
  constraint deployments_version_unique unique (environment, version_id)
);
comment on table public.deployments is 'Verified production deployments; version_id = V + DDMMYYYY + daily counter. Written only by the deployments edge function.';

alter table public.deployments enable row level security;

-- Anyone (including the sign-in screen) may read production releases: they contain no secrets (the repository is public).
drop policy if exists deployments_read_production on public.deployments;
create policy deployments_read_production on public.deployments
  for select to anon, authenticated using (environment = 'production');
-- No insert/update/delete policies: only the service role (edge function) writes, through record_deployment().

-- Append-only for production: releases can never be edited or removed. Test rows may be deleted by the test cleanup.
create or replace function app.guard_deployments() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'deployment records are append-only';
  end if;
  if tg_op = 'DELETE' and old.environment <> 'test' then
    raise exception 'production deployment records cannot be deleted';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists deployments_guard on public.deployments;
create trigger deployments_guard before update or delete on public.deployments
  for each row execute function app.guard_deployments();

-- Atomically assign the next identifier for the deployment date. Idempotent per build.
create or replace function public.record_deployment(
  p_environment text, p_build_id text, p_commit text, p_run_url text default null, p_at timestamptz default now()
) returns table (version_id text, seq integer, deploy_date date, verified_at timestamptz, created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_date date := (p_at at time zone 'Africa/Accra')::date;
  v_seq  integer;
  v_row  public.deployments%rowtype;
begin
  if p_environment not in ('production', 'test') then raise exception 'invalid environment'; end if;
  if p_environment = 'production' and abs(extract(epoch from (p_at - now()))) > 300 then
    raise exception 'production deployments are recorded at the time of verification';
  end if;
  -- serialise all assignments for this environment (deployments are infrequent; correctness over throughput)
  perform pg_advisory_xact_lock(hashtextextended('atlip.deployments.' || p_environment, 0));

  select * into v_row from public.deployments d where d.environment = p_environment and d.build_id = p_build_id;
  if found then
    return query select v_row.version_id, v_row.seq, v_row.deploy_date, v_row.verified_at, false;
    return;
  end if;

  select coalesce(max(d.seq), 0) + 1 into v_seq
    from public.deployments d where d.environment = p_environment and d.deploy_date = v_date;
  if v_seq > 9999 then raise exception 'daily deployment limit (9999) reached'; end if;

  insert into public.deployments (environment, deploy_date, seq, version_id, build_id, commit_sha, run_url, verified_at)
  values (p_environment, v_date, v_seq, 'V' || to_char(v_date, 'DDMMYYYY') || lpad(v_seq::text, 4, '0'),
          p_build_id, lower(p_commit), p_run_url, p_at)
  returning * into v_row;

  if p_environment = 'production' then
    insert into public.audit_logs (actor_id, actor_name, category, action, target)
    values (null, 'Deployment pipeline (GitHub → Hostinger)', 'system',
            'Production deployment verified: ' || v_row.version_id, 'commit ' || left(v_row.commit_sha, 7) || ' · build ' || v_row.build_id);
  end if;
  return query select v_row.version_id, v_row.seq, v_row.deploy_date, v_row.verified_at, true;
end $$;

revoke all on function public.record_deployment(text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_deployment(text, text, text, text, timestamptz) to service_role;

create index if not exists deployments_recent on public.deployments (environment, verified_at desc);
