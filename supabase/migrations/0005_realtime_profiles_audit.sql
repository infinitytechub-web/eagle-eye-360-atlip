-- Eagle Eye 360 · ATLIP — migration 0005: live user directory and audit feed
alter publication supabase_realtime add table public.profiles, public.audit_logs;
