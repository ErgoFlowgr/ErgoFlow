-- Missing settings columns
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ollama_chat_model TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ollama_briefing_model TEXT;

-- Fix offers RLS: allow insert with owner_id
DROP POLICY IF EXISTS "owner only" ON offers;
CREATE POLICY "owner only" ON offers
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "owner only" ON offer_items;
CREATE POLICY "owner only" ON offer_items
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Fix inventory RLS similarly
DROP POLICY IF EXISTS "owner only" ON inventory;
CREATE POLICY "owner only" ON inventory
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
