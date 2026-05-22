-- Keep Supabase settings aligned with shareable local settings fields added after 017.
-- Deliberately excludes device-local or secret fields:
--   sync_enabled, minimize_to_tray, company_logo, bratnet_api_key.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS bratnet_username TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ai_trial_start TIMESTAMPTZ;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ai_trial_used BOOLEAN DEFAULT false;
