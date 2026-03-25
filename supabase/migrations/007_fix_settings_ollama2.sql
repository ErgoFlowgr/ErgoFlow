ALTER TABLE settings ADD COLUMN IF NOT EXISTS ollama_embed_model TEXT;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS ollama_chat_model TEXT;

-- Re-create offers/offer_items policies with INSERT permission
DROP POLICY IF EXISTS "owner only" ON offers;
CREATE POLICY "owner only" ON offers
  FOR ALL USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "owner only" ON offer_items;
CREATE POLICY "owner only" ON offer_items
  FOR ALL USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "owner only" ON inventory;
CREATE POLICY "owner only" ON inventory
  FOR ALL USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);
