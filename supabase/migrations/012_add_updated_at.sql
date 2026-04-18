-- Add missing updated_at columns to child tables
-- These are needed for incremental sync (updated_at=gte.X filter)
ALTER TABLE offer_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill existing rows to use current time as a baseline
UPDATE offer_items SET updated_at = now() WHERE updated_at IS NULL;
UPDATE invoice_items SET updated_at = now() WHERE updated_at IS NULL;

-- Add missing settings columns (image_model was added locally but never migrated)
-- Without these, settings push fails → settings never sync to Supabase → second device sees empty settings
ALTER TABLE settings ADD COLUMN IF NOT EXISTS image_model TEXT;
