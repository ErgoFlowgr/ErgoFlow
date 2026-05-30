-- Migration 024: Lock down mutable search_path on existing functions.
--
-- Background: Supabase Security Advisor flags `set_updated_at` and
-- `match_document_chunks` as having a mutable `search_path`. A mutable
-- search_path lets a malicious schema earlier in the path shadow built-in
-- objects (e.g. `pg_temp.now()`) and is the standard hardening fix
-- recommended by both Supabase and PostgreSQL upstream.
--
-- This migration is purely an ALTER on existing function signatures. It does
-- NOT recreate the functions, so behaviour is unchanged. Each statement is
-- wrapped in a DO block that no-ops if the function isn't present (e.g. on
-- a fresh dev DB where set_updated_at was never created).

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'set_updated_at'
  ) then
    execute 'alter function public.set_updated_at() set search_path = public, pg_temp';
  end if;
end$$;

do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'match_document_chunks'
  ) then
    execute 'alter function public.match_document_chunks(vector, int, uuid) set search_path = public, pg_temp';
  end if;
end$$;
