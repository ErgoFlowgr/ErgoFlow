-- 023_explicit_data_api_grants.sql
--
-- Future-proofs ErgoFlow against the Supabase Data API change announced 2026-05-30.
--
-- From 2026-10-30, new tables in existing projects will NO LONGER be auto-exposed
-- to PostgREST / GraphQL / supabase-js. Tables must have explicit GRANTs to
-- anon / authenticated / service_role to be visible through the Data API.
--
-- This migration:
--   1. Confirms schema USAGE for the three API roles.
--   2. Grants table + sequence access to `authenticated` on everything currently
--      in public (matches today's app behavior: logged-in users do all CRUD,
--      RLS policies remain the real gatekeeper).
--   3. Sets ALTER DEFAULT PRIVILEGES so any FUTURE table/sequence created in
--      public automatically gets the same grants — meaning new migrations
--      won't silently break after the October 2026 enforcement date.
--   4. Leaves `anon` untouched (current posture: no anonymous table access).
--   5. Service_role keeps its implicit bypass; explicit grant left to targeted
--      migrations like 021 where edge functions need it.
--
-- RLS policies are unchanged — security model is unaffected.

-- 1. Schema usage (idempotent; already true today, included for completeness)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- 2. Current tables: grant CRUD to authenticated
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO authenticated;

-- 3. Current sequences: grant usage to authenticated (for inserts using nextval)
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO authenticated;

-- 4. Default privileges for FUTURE tables created in public
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

-- 5. Default privileges for FUTURE sequences created in public
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;
