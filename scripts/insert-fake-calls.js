// Run with: npx electron scripts/insert-fake-calls.js
const path = require('path')
const os = require('os')

// Use the same DB path as the app
const dbPath = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'ergoflow',
  'crm-6da25bf3-0ec6-4e93-8c75-7049dc78e3de.db'
)

const Database = require(path.join(__dirname, '../node_modules/better-sqlite3'))
const db = new Database(dbPath)

const calls = [
  {
    id: 'fake-call-001',
    customer_name: 'Nick Papadopoulos',
    customer_phone: '+44 7700 900 123',
    direction: 'inbound',
    status: 'completed',
    duration_seconds: 187,
    summary: 'Customer requested a quote for installation of a 12000 BTU AC unit.',
    started_at: new Date(Date.now() - 2 * 3600000).toISOString(),
    ended_at:   new Date(Date.now() - 2 * 3600000 + 187000).toISOString(),
  },
  {
    id: 'fake-call-002',
    customer_name: 'Maria Constantine',
    customer_phone: '+44 7911 123 456',
    direction: 'inbound',
    status: 'completed',
    duration_seconds: 94,
    summary: 'Customer asked about availability for a maintenance visit next week.',
    started_at: new Date(Date.now() - 5 * 3600000).toISOString(),
    ended_at:   new Date(Date.now() - 5 * 3600000 + 94000).toISOString(),
  },
  {
    id: 'fake-call-003',
    customer_name: 'George Antoniu',
    customer_phone: '+44 7800 555 321',
    direction: 'inbound',
    status: 'no-answer',
    duration_seconds: 0,
    summary: null,
    started_at: new Date(Date.now() - 7 * 3600000).toISOString(),
    ended_at:   new Date(Date.now() - 7 * 3600000 + 5000).toISOString(),
  },
  {
    id: 'fake-call-004',
    customer_name: 'Steve Dimitriou',
    customer_phone: '+44 7912 987 654',
    direction: 'outbound',
    status: 'completed',
    duration_seconds: 312,
    summary: 'Confirmed appointment for tomorrow at 10:00 AM. New AC unit installation.',
    started_at: new Date(Date.now() - 24 * 3600000).toISOString(),
    ended_at:   new Date(Date.now() - 24 * 3600000 + 312000).toISOString(),
  },
]

const stmt = db.prepare(`
  INSERT OR IGNORE INTO calls (id, customer_name, customer_phone, direction, status, duration_seconds, summary, started_at, ended_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

for (const c of calls) {
  stmt.run(c.id, c.customer_name, c.customer_phone, c.direction, c.status, c.duration_seconds, c.summary, c.started_at, c.ended_at)
  console.log('Inserted:', c.customer_name)
}

db.close()
console.log('Done.')
process.exit(0)
