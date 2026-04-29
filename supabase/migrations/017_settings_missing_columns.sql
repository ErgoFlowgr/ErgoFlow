-- Add all settings columns that exist locally but were never migrated to Supabase.
-- Without these, any push of the settings row fails with PGRST204, causing
-- company data and all other settings to never sync.

ALTER TABLE settings ADD COLUMN IF NOT EXISTS image_model TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ollama_vision_model TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS company_vat TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mydata_user_id TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS mydata_api_key TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS license_verified_at TIMESTAMPTZ;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS license_tier TEXT DEFAULT 'basic';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS license_status TEXT DEFAULT 'trial';
ALTER TABLE settings ADD COLUMN IF NOT EXISTS license_trial_end TIMESTAMPTZ;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sync_enabled INTEGER DEFAULT 0;

-- Fix settings RLS to explicitly cover INSERT (add WITH CHECK).
-- The original policy had only USING, which works but is ambiguous.
DROP POLICY IF EXISTS "owner only" ON settings;
CREATE POLICY "owner only" ON settings
  FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
