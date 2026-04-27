import { isElectron } from './electron'

export interface DbDriver {
  query(sql: string, params?: unknown[]): Promise<unknown[]>
  run(sql: string, params?: unknown[]): Promise<{ changes: number; lastInsertRowid: number }>
  get(sql: string, params?: unknown[]): Promise<unknown | undefined>
  switch(userId: string): Promise<void>
  bulkDeleteCustomers(ids: string[]): Promise<void>
}

// ─── Electron driver ─────────────────────────────────────────────────────────

const electronDriver: DbDriver = {
  query:               (sql, params) => window.electron!.db.query(sql, params),
  run:                 (sql, params) => window.electron!.db.run(sql, params),
  get:                 (sql, params) => window.electron!.db.get(sql, params),
  switch:              (userId)      => window.electron!.db.switch(userId),
  bulkDeleteCustomers: (ids)         => window.electron!.db.bulkDeleteCustomers(ids),
}

// ─── Android (Capacitor SQLite) driver ───────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sqlite: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _conn: any = null
let _dbName = 'ergoflow_default'

async function getSqlite() {
  if (!_sqlite) {
    const mod = await import('@capacitor-community/sqlite')
    _sqlite = new mod.SQLiteConnection(mod.CapacitorSQLite)
  }
  return _sqlite
}

async function getConn(dbName = _dbName) {
  const sqlite = await getSqlite()
  if (_conn && _dbName === dbName) return _conn

  try { await sqlite.checkConnectionsConsistency() } catch { /* ignore */ }

  const isConn = (await sqlite.isConnection(dbName, false)).result
  if (isConn) {
    _conn = await sqlite.retrieveConnection(dbName, false)
  } else {
    _conn = await sqlite.createConnection(dbName, false, 'no-encryption', 1, false)
    await _conn.open()
    await runMigrations(_conn)
  }
  _dbName = dbName
  return _conn
}

// Full schema — mirrors electron/db.ts exactly
const CREATE_TABLES = `
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

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT
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

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_customer ON jobs(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_calls_started ON calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON sync_queue(table_name);
CREATE INDEX IF NOT EXISTS idx_overseer_log_date ON overseer_log(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
CREATE INDEX IF NOT EXISTS idx_offer_items_offer ON offer_items(offer_id);
CREATE INDEX IF NOT EXISTS idx_inventory_code ON inventory(code);

INSERT OR IGNORE INTO settings (id) VALUES ('main');
`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runMigrations(conn: any): Promise<void> {
  await conn.execute(CREATE_TABLES, false)

  const tryAlter = async (sql: string) => {
    try { await conn.run(sql, [], false) } catch { /* column already exists */ }
  }

  await tryAlter(`ALTER TABLE jobs ADD COLUMN keep_indefinitely INTEGER DEFAULT 0`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN claude_api_key TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN synced INTEGER DEFAULT 0`)
  await tryAlter(`ALTER TABLE customers ADD COLUMN company_name TEXT`)
  await tryAlter(`ALTER TABLE customers ADD COLUMN coc_number TEXT`)
  await tryAlter(`ALTER TABLE customers ADD COLUMN vat_number TEXT`)
  await tryAlter(`ALTER TABLE customers ADD COLUMN salutation TEXT`)
  await tryAlter(`ALTER TABLE customers ADD COLUMN first_name TEXT`)
  await tryAlter(`ALTER TABLE customers ADD COLUMN last_name TEXT`)
  await tryAlter(`ALTER TABLE customers ADD COLUMN mobile TEXT`)
  await tryAlter(`ALTER TABLE customers ADD COLUMN fax TEXT`)
  await tryAlter(`ALTER TABLE customers ADD COLUMN postal_code TEXT`)
  await tryAlter(`ALTER TABLE customers ADD COLUMN city TEXT`)
  await tryAlter(`ALTER TABLE customers ADD COLUMN country TEXT`)
  await tryAlter(`ALTER TABLE invoices ADD COLUMN discount_type TEXT DEFAULT NULL`)
  await tryAlter(`ALTER TABLE invoices ADD COLUMN discount_value REAL DEFAULT 0`)
  await tryAlter(`ALTER TABLE invoices ADD COLUMN discount_amount REAL DEFAULT 0`)
  await tryAlter(`ALTER TABLE invoices ADD COLUMN document_type TEXT DEFAULT 'invoice'`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN phone2 TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN address TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN allow_web_search INTEGER DEFAULT 0`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN brave_search_key TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN owner_last_name TEXT`)
  await tryAlter(`ALTER TABLE invoice_items ADD COLUMN synced INTEGER DEFAULT 0`)
  await tryAlter(`ALTER TABLE jobs ADD COLUMN offer_id TEXT`)
  await tryAlter(`ALTER TABLE jobs ADD COLUMN invoice_id TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN hidden_tabs TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN image_model TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN ollama_vision_model TEXT`)
  await tryAlter(`ALTER TABLE invoices ADD COLUMN mydata_mark TEXT DEFAULT NULL`)
  await tryAlter(`ALTER TABLE invoices ADD COLUMN mydata_status TEXT DEFAULT 'pending'`)
  await tryAlter(`ALTER TABLE invoices ADD COLUMN mydata_error TEXT DEFAULT NULL`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN company_vat TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN mydata_user_id TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN mydata_api_key TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN license_verified_at TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN license_tier TEXT DEFAULT 'basic'`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN license_status TEXT DEFAULT 'trial'`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN license_trial_end TEXT`)
  await tryAlter(`ALTER TABLE settings ADD COLUMN sync_enabled INTEGER DEFAULT 0`)

  // Deduplicate sync_queue and add unique index
  try {
    await conn.run(
      `DELETE FROM sync_queue WHERE id NOT IN (SELECT MAX(id) FROM sync_queue GROUP BY table_name, record_id)`,
      [], false
    )
    await conn.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_queue_unique ON sync_queue(table_name, record_id)`,
      [], false
    )
  } catch { /* ignore */ }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toSqlParams(params: unknown[]): any[] {
  return params.map(v => {
    if (typeof v === 'boolean') return v ? 1 : 0
    if (v === undefined) return null
    return v
  })
}

const androidDriver: DbDriver = {
  async query(sql, params = []) {
    const conn = await getConn()
    const result = await conn.query(sql, toSqlParams(params))
    return result.values ?? []
  },

  async run(sql, params = []) {
    const conn = await getConn()
    const result = await conn.run(sql, toSqlParams(params), true)
    return {
      changes:         result.changes?.changes      ?? 0,
      lastInsertRowid: result.changes?.lastId        ?? 0,
    }
  },

  async get(sql, params = []) {
    const conn = await getConn()
    const result = await conn.query(sql, toSqlParams(params))
    return result.values?.[0] ?? undefined
  },

  async switch(userId) {
    const newName = `ergoflow_${userId.replace(/-/g, '_')}`
    if (newName === _dbName && _conn) {
      try { await androidDriver.run(`DELETE FROM sync_meta WHERE key = 'last_pull_at'`) } catch { /* ignore */ }
      return
    }
    const sqlite = await getSqlite()
    if (_conn) {
      try { await sqlite.closeConnection(_dbName, false) } catch { /* ignore */ }
      _conn = null
    }
    _dbName = newName
    await getConn(newName)
    try { await androidDriver.run(`DELETE FROM sync_meta WHERE key = 'last_pull_at'`) } catch { /* ignore */ }
  },

  async bulkDeleteCustomers(ids) {
    if (!ids.length) return
    for (const id of ids) {
      await androidDriver.run(`DELETE FROM customers WHERE id = ?`, [id])
    }
  },
}

export const db: DbDriver = isElectron ? electronDriver : androidDriver
