import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'

let db: Database.Database

export function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'crm.db')
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations()
}

export function switchDatabase(userId: string) {
  try { db.close() } catch { /* ignore */ }
  const dbPath = path.join(app.getPath('userData'), `crm-${userId}.db`)
  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations()
  // Clear last_pull_at so the next sync does a full pull from Supabase
  try {
    db.prepare("CREATE TABLE IF NOT EXISTS sync_meta (key TEXT PRIMARY KEY, value TEXT)").run()
    db.prepare("DELETE FROM sync_meta WHERE key = 'last_pull_at'").run()
  } catch { /* ignore */ }
}

export function getDb() {
  if (!db) throw new Error('Database not initialized')
  return db
}

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);

    CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY DEFAULT 'main',
      company_name TEXT,
      owner_name TEXT,
      phone TEXT,
      work_type TEXT,
      ai_provider TEXT DEFAULT 'claude',
      ollama_url TEXT DEFAULT 'http://localhost:11434',
      ollama_chat_model TEXT DEFAULT 'qwen2.5:latest',
      ollama_embed_model TEXT DEFAULT 'nomic-embed-text',
      ollama_briefing_model TEXT DEFAULT 'deepseek-r1:14b',
      language TEXT DEFAULT 'el',
      onboarding_complete INTEGER DEFAULT 0,
      briefing_time TEXT DEFAULT '08:00',
      briefing_enabled INTEGER DEFAULT 0,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name_el TEXT NOT NULL,
      name_en TEXT NOT NULL,
      color TEXT DEFAULT '#4f6ef7',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS calls (
      id TEXT PRIMARY KEY,
      vapi_call_id TEXT UNIQUE,
      customer_id TEXT REFERENCES customers(id),
      customer_phone TEXT,
      customer_name TEXT,
      direction TEXT DEFAULT 'inbound',
      status TEXT DEFAULT 'completed',
      category_id TEXT REFERENCES categories(id),
      duration_seconds INTEGER,
      transcript TEXT,
      summary TEXT,
      recording_url TEXT,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      file_size INTEGER,
      page_count INTEGER,
      uploaded_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      embedding TEXT,
      chunk_index INTEGER,
      page_number INTEGER
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS overseer_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checked_at TEXT DEFAULT (datetime('now')),
      status TEXT NOT NULL,
      checks TEXT NOT NULL,
      briefing TEXT,
      errors TEXT
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      customer_id TEXT REFERENCES customers(id),
      customer_name TEXT,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending',
      priority TEXT DEFAULT 'normal',
      scheduled_date TEXT,
      completed_date TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      customer_id TEXT REFERENCES customers(id),
      customer_name TEXT,
      customer_address TEXT,
      status TEXT DEFAULT 'draft',
      issue_date TEXT,
      due_date TEXT,
      notes TEXT,
      subtotal REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      mydata_mark TEXT DEFAULT NULL,
      mydata_status TEXT DEFAULT 'pending',
      mydata_error TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id TEXT PRIMARY KEY,
      invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity REAL DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON sync_queue(table_name);
    CREATE INDEX IF NOT EXISTS idx_overseer_log_date ON overseer_log(checked_at DESC);

    CREATE TABLE IF NOT EXISTS offers (
      id TEXT PRIMARY KEY,
      number TEXT NOT NULL,
      customer_id TEXT REFERENCES customers(id),
      customer_name TEXT,
      customer_address TEXT,
      status TEXT DEFAULT 'pending',
      issue_date TEXT,
      expiry_date TEXT,
      notes TEXT,
      subtotal REAL DEFAULT 0,
      discount_type TEXT DEFAULT NULL,
      discount_value REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      tax_rate REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      total REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS offer_items (
      id TEXT PRIMARY KEY,
      offer_id TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      quantity REAL DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total REAL DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      synced INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
    CREATE INDEX IF NOT EXISTS idx_offer_items_offer ON offer_items(offer_id);

    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT,
      unit TEXT DEFAULT 'τεμ.',
      price REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      synced INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_code ON inventory(code);

    INSERT OR IGNORE INTO settings (id) VALUES ('main');
  `)

  // Safe column additions (ignored if already exist)
  const tryAlter = (sql: string) => { try { db.exec(sql) } catch { /* column exists */ } }
  tryAlter(`ALTER TABLE jobs ADD COLUMN keep_indefinitely INTEGER DEFAULT 0`)
  // Settings extended fields (for Android sync)
  tryAlter(`ALTER TABLE settings ADD COLUMN claude_api_key TEXT`)
  tryAlter(`ALTER TABLE settings ADD COLUMN synced INTEGER DEFAULT 0`)
  // Customer extended fields
  tryAlter(`ALTER TABLE customers ADD COLUMN company_name TEXT`)
  tryAlter(`ALTER TABLE customers ADD COLUMN coc_number TEXT`)
  tryAlter(`ALTER TABLE customers ADD COLUMN vat_number TEXT`)
  tryAlter(`ALTER TABLE customers ADD COLUMN salutation TEXT`)
  tryAlter(`ALTER TABLE customers ADD COLUMN first_name TEXT`)
  tryAlter(`ALTER TABLE customers ADD COLUMN last_name TEXT`)
  tryAlter(`ALTER TABLE customers ADD COLUMN mobile TEXT`)
  tryAlter(`ALTER TABLE customers ADD COLUMN fax TEXT`)
  tryAlter(`ALTER TABLE customers ADD COLUMN postal_code TEXT`)
  tryAlter(`ALTER TABLE customers ADD COLUMN city TEXT`)
  tryAlter(`ALTER TABLE customers ADD COLUMN country TEXT`)
  // Invoice discount fields
  tryAlter(`ALTER TABLE invoices ADD COLUMN discount_type TEXT DEFAULT NULL`)
  tryAlter(`ALTER TABLE invoices ADD COLUMN discount_value REAL DEFAULT 0`)
  tryAlter(`ALTER TABLE invoices ADD COLUMN discount_amount REAL DEFAULT 0`)
  // Invoice document type
  tryAlter(`ALTER TABLE invoices ADD COLUMN document_type TEXT DEFAULT 'invoice'`)
  // Settings extra company fields
  tryAlter(`ALTER TABLE settings ADD COLUMN phone2 TEXT`)
  tryAlter(`ALTER TABLE settings ADD COLUMN address TEXT`)
  tryAlter(`ALTER TABLE settings ADD COLUMN allow_web_search INTEGER DEFAULT 0`)
  tryAlter(`ALTER TABLE settings ADD COLUMN brave_search_key TEXT`)
  tryAlter(`ALTER TABLE settings ADD COLUMN owner_last_name TEXT`)
  tryAlter(`ALTER TABLE invoice_items ADD COLUMN synced INTEGER DEFAULT 0`)
  tryAlter(`ALTER TABLE jobs ADD COLUMN offer_id TEXT`)
  tryAlter(`ALTER TABLE jobs ADD COLUMN invoice_id TEXT`)
  tryAlter(`ALTER TABLE settings ADD COLUMN hidden_tabs TEXT`)
  tryAlter(`ALTER TABLE settings ADD COLUMN image_model TEXT`)
  tryAlter(`ALTER TABLE settings ADD COLUMN ollama_vision_model TEXT`)
  // Invoice myDATA fields
  tryAlter(`ALTER TABLE invoices ADD COLUMN mydata_mark TEXT DEFAULT NULL`)
  tryAlter(`ALTER TABLE invoices ADD COLUMN mydata_status TEXT DEFAULT 'pending'`)
  tryAlter(`ALTER TABLE invoices ADD COLUMN mydata_error TEXT DEFAULT NULL`)
  // Settings myDATA credentials
  tryAlter(`ALTER TABLE settings ADD COLUMN company_vat TEXT`)
  tryAlter(`ALTER TABLE settings ADD COLUMN mydata_user_id TEXT`)
  tryAlter(`ALTER TABLE settings ADD COLUMN mydata_api_key TEXT`)
  // Offline license cache (30-day verification model)
  tryAlter(`ALTER TABLE settings ADD COLUMN license_verified_at TEXT`)
  tryAlter(`ALTER TABLE settings ADD COLUMN license_tier TEXT DEFAULT 'basic'`)
  tryAlter(`ALTER TABLE settings ADD COLUMN license_status TEXT DEFAULT 'trial'`)
  tryAlter(`ALTER TABLE settings ADD COLUMN license_trial_end TEXT`)
  // Cloud sync opt-in (default OFF — data stays local)
  tryAlter(`ALTER TABLE settings ADD COLUMN sync_enabled INTEGER DEFAULT 0`)

  // Deduplicate sync_queue (keep newest per table+record) and add unique index
  // This fixes a bug where the same record was queued many times, causing sync hammering
  try {
    db.prepare(`DELETE FROM sync_queue WHERE id NOT IN (
      SELECT MAX(id) FROM sync_queue GROUP BY table_name, record_id
    )`).run()
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_unique ON sync_queue(table_name, record_id)`).run()
  } catch { /* ignore — index may already exist */ }
}

/** Delete pending jobs older than 30 days that are not pinned. */
export function cleanupOldPendingJobs(): number {
  const result = getDb().prepare(
    `DELETE FROM jobs
     WHERE status = 'pending'
       AND keep_indefinitely = 0
       AND COALESCE(scheduled_date, created_at) < datetime('now', '-30 days')`
  ).run()
  return result.changes
}
