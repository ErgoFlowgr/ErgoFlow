-- 025_deleted_records_tombstones.sql
--
-- Adds the tombstone table used by the desktop and Android sync engines to
-- propagate deletes between devices. Without this table, a delete can succeed
-- on Supabase but other devices have no durable record telling them to remove
-- their local SQLite copy.

CREATE TABLE IF NOT EXISTS deleted_records (
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, table_name, record_id),
  CONSTRAINT deleted_records_table_name_allowed CHECK (
    table_name IN (
      'settings',
      'customers',
      'calls',
      'categories',
      'documents',
      'document_chunks',
      'chat_messages',
      'jobs',
      'invoices',
      'invoice_items',
      'offers',
      'offer_items',
      'inventory'
    )
  )
);

CREATE INDEX IF NOT EXISTS deleted_records_owner_deleted_at_idx
  ON deleted_records (owner_id, deleted_at DESC);

ALTER TABLE deleted_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner only" ON deleted_records;
CREATE POLICY "owner only" ON deleted_records
  FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- Be explicit even though 023 sets default privileges for future tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON deleted_records TO authenticated;
