/**
 * Database helpers — thin wrappers over IPC calls to the main process SQLite.
 * All queries run in the Electron main process; renderer just sends/receives data.
 */
import { db } from './db-driver'
import { submitToMydata } from './mydata'
import { v4 as uuid } from 'uuid'

export { uuid }

// ── Settings ───────────────────────────────────────────────────────────────

export interface Settings {
  id: string
  company_name: string | null
  owner_name: string | null
  owner_last_name: string | null
  phone: string | null
  phone2: string | null
  address: string | null
  work_type: string | null
  language: 'el' | 'en'
  onboarding_complete: number
  briefing_time: string
  briefing_enabled: number
  claude_api_key: string | null  // synced to Supabase so Android can read it
  allow_web_search: number
  brave_search_key: string | null
  hidden_tabs: string | null  // JSON array of tab paths e.g. '["calls","invoices"]'
  image_model: string | null
  company_vat: string | null        // ΑΦΜ εταιρείας for myDATA
  mydata_user_id: string | null     // ΑΑΔΕ username (aade-user-id)
  mydata_api_key: string | null     // myDATA Ocp-Apim-Subscription-Key
  // Offline license cache
  license_verified_at: string | null
  license_tier: string | null
  license_status: string | null
  license_trial_end: string | null
  // Cloud sync opt-in
  sync_enabled: number
  // Minimize to tray instead of closing
  minimize_to_tray: number
  // Company logo stored as base64 data URL
  company_logo: string | null
}

export async function getSettings(): Promise<Settings> {
  return db.get('SELECT * FROM settings WHERE id = ?', ['main']) as Promise<Settings>
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cols = Object.keys(patch).filter(k => k !== 'id')
  const sets = cols.map(c => `${c} = ?`).join(', ')
  const vals = cols.map(k => (patch as Record<string, unknown>)[k])
  await db.run(`UPDATE settings SET ${sets}, updated_at = datetime('now') WHERE id = 'main'`, vals)
  // Queue settings sync so Android can read updated values from Supabase
  await db.run(
    'INSERT OR REPLACE INTO sync_queue (table_name, record_id, operation) VALUES (?, ?, ?)',
    ['settings', 'main', 'upsert']
  )
  window.dispatchEvent(new CustomEvent('settings:changed'))
}

// ── Categories ─────────────────────────────────────────────────────────────

export interface Category {
  id: string
  name_el: string
  name_en: string
  color: string
}

export async function getCategories(): Promise<Category[]> {
  return db.query('SELECT * FROM categories ORDER BY name_el') as Promise<Category[]>
}

export async function upsertCategory(cat: Omit<Category, 'id'> & { id?: string }): Promise<string> {
  const id = cat.id ?? uuid()
  await db.run(
    `INSERT INTO categories (id, name_el, name_en, color) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name_el=excluded.name_el, name_en=excluded.name_en, color=excluded.color, synced=0`,
    [id, cat.name_el, cat.name_en, cat.color]
  )
  await queueSync('categories', id, 'upsert')
  return id
}

export async function deleteCategory(id: string): Promise<void> {
  await db.run('DELETE FROM categories WHERE id = ?', [id])
  await queueSync('categories', id, 'delete')
}

// ── Customers ──────────────────────────────────────────────────────────────

export interface Customer {
  id: string
  name: string          // display name (computed: company_name || first+last)
  company_name: string | null
  coc_number: string | null
  vat_number: string | null
  salutation: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  mobile: string | null
  fax: string | null
  email: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  country: string | null
  notes: string | null
  created_at: string
}

export async function getCustomers(search?: string): Promise<Customer[]> {
  if (search) {
    const q = `%${search}%`
    return db.query(
      'SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name',
      [q, q]
    ) as Promise<Customer[]>
  }
  return db.query('SELECT * FROM customers ORDER BY name') as Promise<Customer[]>
}

export async function upsertCustomer(c: Partial<Customer> & { name: string }): Promise<string> {
  const id = c.id ?? uuid()
  await db.run(
    `INSERT INTO customers
       (id, name, company_name, coc_number, vat_number, salutation, first_name, last_name,
        phone, mobile, fax, email, address, postal_code, city, country, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, company_name=excluded.company_name, coc_number=excluded.coc_number,
       vat_number=excluded.vat_number, salutation=excluded.salutation,
       first_name=excluded.first_name, last_name=excluded.last_name,
       phone=excluded.phone, mobile=excluded.mobile, fax=excluded.fax,
       email=excluded.email, address=excluded.address,
       postal_code=excluded.postal_code, city=excluded.city, country=excluded.country,
       notes=excluded.notes, updated_at=datetime('now'), synced=0`,
    [id, c.name,
     c.company_name ?? null, c.coc_number ?? null, c.vat_number ?? null,
     c.salutation ?? null, c.first_name ?? null, c.last_name ?? null,
     c.phone ?? null, c.mobile ?? null, c.fax ?? null, c.email ?? null,
     c.address ?? null, c.postal_code ?? null, c.city ?? null, c.country ?? null,
     c.notes ?? null]
  )
  await queueSync('customers', id, 'upsert')
  // Propagate name change to all linked records
  if (c.id) {
    await db.run(`UPDATE jobs     SET customer_name = ?, updated_at = datetime('now'), synced = 0 WHERE customer_id = ?`, [c.name, c.id])
    await db.run(`UPDATE offers   SET customer_name = ?, updated_at = datetime('now'), synced = 0 WHERE customer_id = ?`, [c.name, c.id])
    await db.run(`UPDATE invoices SET customer_name = ?, updated_at = datetime('now'), synced = 0 WHERE customer_id = ?`, [c.name, c.id])
  }
  return id
}

export async function deleteCustomer(id: string): Promise<void> {
  await db.run('DELETE FROM customers WHERE id = ?', [id])
  await queueSync('customers', id, 'delete')
}

export async function deleteCustomers(ids: string[]): Promise<void> {
  if (!ids.length) return
  await db.bulkDeleteCustomers(ids)
}

// ── Calls ──────────────────────────────────────────────────────────────────

export interface Call {
  id: string
  vapi_call_id: string | null
  customer_id: string | null
  customer_phone: string | null
  customer_name: string | null
  direction: string
  status: string
  category_id: string | null
  duration_seconds: number | null
  transcript: string | null
  summary: string | null
  recording_url: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string
}

export async function getCalls(limit = 200): Promise<Call[]> {
  return db.query(
    'SELECT * FROM calls ORDER BY started_at DESC LIMIT ?',
    [limit]
  ) as Promise<Call[]>
}

export async function deleteCall(id: string): Promise<void> {
  await db.run('DELETE FROM calls WHERE id = ?', [id])
  await queueSync('calls', id, 'delete')
}

export async function getCallsByCustomer(customerId: string): Promise<Call[]> {
  return db.query(
    `SELECT * FROM calls
     WHERE customer_id = ? OR customer_phone = (SELECT phone FROM customers WHERE id = ?)
     ORDER BY started_at DESC`,
    [customerId, customerId]
  ) as Promise<Call[]>
}

export async function getCallStats(): Promise<{
  total: number; inbound: number; outbound: number; missed: number
}> {
  const total    = (await db.get('SELECT COUNT(*) as n FROM calls') as { n: number }).n
  const inbound  = (await db.get("SELECT COUNT(*) as n FROM calls WHERE direction='inbound'") as { n: number }).n
  const outbound = (await db.get("SELECT COUNT(*) as n FROM calls WHERE direction='outbound'") as { n: number }).n
  const missed   = (await db.get("SELECT COUNT(*) as n FROM calls WHERE status='missed'") as { n: number }).n
  return { total, inbound, outbound, missed }
}

// ── Documents & Chunks ─────────────────────────────────────────────────────

export interface Document {
  id: string
  name: string
  file_size: number | null
  page_count: number | null
  uploaded_at: string
}

export async function getDocuments(): Promise<Document[]> {
  return db.query('SELECT * FROM documents ORDER BY uploaded_at DESC') as Promise<Document[]>
}

export async function insertDocument(doc: Omit<Document, 'uploaded_at'>): Promise<void> {
  await db.run(
    'INSERT INTO documents (id, name, file_size, page_count) VALUES (?, ?, ?, ?)',
    [doc.id, doc.name, doc.file_size, doc.page_count]
  )
}

export async function insertChunks(
  chunks: Array<{ id: string; document_id: string; content: string; embedding: string; chunk_index: number; page_number: number }>
): Promise<void> {
  for (const c of chunks) {
    await db.run(
      'INSERT INTO document_chunks (id, document_id, content, embedding, chunk_index, page_number) VALUES (?, ?, ?, ?, ?, ?)',
      [c.id, c.document_id, c.content, c.embedding, c.chunk_index, c.page_number]
    )
  }
}

export async function searchChunks(queryEmbedding: number[], limit = 5): Promise<Array<{ content: string; chunk_index: number }>> {
  // Cosine similarity in JS (SQLite doesn't have vector ops natively)
  const rows = await db.query('SELECT content, embedding, chunk_index FROM document_chunks') as Array<{
    content: string; embedding: string; chunk_index: number
  }>

  const scored = rows.map(row => {
    const emb = JSON.parse(row.embedding) as number[]
    const score = cosineSimilarity(queryEmbedding, emb)
    return { content: row.content, chunk_index: row.chunk_index, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] ** 2
    normB += b[i] ** 2
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1)
}

// ── Chat messages ──────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export async function getChatHistory(): Promise<ChatMessage[]> {
  return db.query('SELECT * FROM chat_messages ORDER BY created_at ASC') as Promise<ChatMessage[]>
}

export async function insertChatMessage(msg: Omit<ChatMessage, 'created_at'>): Promise<void> {
  await db.run(
    'INSERT INTO chat_messages (id, role, content) VALUES (?, ?, ?)',
    [msg.id, msg.role, msg.content]
  )
}

export async function updateChatMessage(id: string, content: string): Promise<void> {
  await db.run('UPDATE chat_messages SET content = ? WHERE id = ?', [content, id])
}

export async function clearChatHistory(): Promise<void> {
  await db.run('DELETE FROM chat_messages')
}

// ── Overseer log ───────────────────────────────────────────────────────────

export interface OverseerEntry {
  id: number
  checked_at: string
  status: string
  checks: string
  briefing: string
  errors: string
}

export async function getOverseerLog(limit = 30): Promise<OverseerEntry[]> {
  return db.query(
    'SELECT * FROM overseer_log ORDER BY checked_at DESC LIMIT ?',
    [limit]
  ) as Promise<OverseerEntry[]>
}

// ── Jobs ───────────────────────────────────────────────────────────────────

export interface Job {
  id: string
  customer_id: string | null
  customer_name: string | null
  title: string
  description: string | null
  status: 'pending' | 'in-progress' | 'completed' | 'cancelled'
  priority: 'low' | 'normal' | 'high'
  scheduled_date: string | null
  completed_date: string | null
  notes: string | null
  keep_indefinitely: number   // 1 = never auto-delete
  offer_id: string | null
  invoice_id: string | null
  created_at: string
  updated_at: string
}

export async function getJobs(status?: string): Promise<Job[]> {
  if (status) {
    return db.query('SELECT * FROM jobs WHERE status = ? ORDER BY scheduled_date ASC, created_at DESC', [status]) as Promise<Job[]>
  }
  return db.query('SELECT * FROM jobs ORDER BY scheduled_date ASC, created_at DESC') as Promise<Job[]>
}

export async function getJobsByCustomer(customerId: string): Promise<Job[]> {
  return db.query('SELECT * FROM jobs WHERE customer_id = ? ORDER BY created_at DESC', [customerId]) as Promise<Job[]>
}

export async function upsertJob(j: Partial<Job> & { title: string }): Promise<string> {
  const id = j.id ?? uuid()
  await db.run(
    `INSERT INTO jobs (id, customer_id, customer_name, title, description, status, priority, scheduled_date, completed_date, notes, keep_indefinitely, offer_id, invoice_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       customer_id=excluded.customer_id, customer_name=excluded.customer_name,
       title=excluded.title, description=excluded.description, status=excluded.status,
       priority=excluded.priority, scheduled_date=excluded.scheduled_date,
       completed_date=excluded.completed_date, notes=excluded.notes,
       keep_indefinitely=excluded.keep_indefinitely, offer_id=excluded.offer_id,
       invoice_id=excluded.invoice_id,
       updated_at=datetime('now'), synced=0`,
    [id, j.customer_id ?? null, j.customer_name ?? null, j.title,
     j.description ?? null, j.status ?? 'pending', j.priority ?? 'normal',
     j.scheduled_date ?? null, j.completed_date ?? null, j.notes ?? null,
     j.keep_indefinitely ?? 0, j.offer_id ?? null, j.invoice_id ?? null]
  )
  await queueSync('jobs', id, 'upsert')
  return id
}

export async function deleteJob(id: string): Promise<void> {
  await db.run('DELETE FROM jobs WHERE id = ?', [id])
  await queueSync('jobs', id, 'delete')
}

export async function getJobStats(): Promise<{ total: number; pending: number; inProgress: number; completed: number }> {
  const total      = (await db.get('SELECT COUNT(*) as n FROM jobs') as { n: number }).n
  const pending    = (await db.get("SELECT COUNT(*) as n FROM jobs WHERE status='pending'") as { n: number }).n
  const inProgress = (await db.get("SELECT COUNT(*) as n FROM jobs WHERE status='in-progress'") as { n: number }).n
  const completed  = (await db.get("SELECT COUNT(*) as n FROM jobs WHERE status='completed'") as { n: number }).n
  return { total, pending, inProgress, completed }
}

// ── Invoices ───────────────────────────────────────────────────────────────

export interface Invoice {
  id: string
  number: string
  document_type: 'invoice' | 'receipt'
  customer_id: string | null
  customer_name: string | null
  customer_address: string | null
  status: 'draft' | 'pending' | 'paid'
  issue_date: string | null
  due_date: string | null
  notes: string | null
  subtotal: number
  discount_type: 'percent' | 'flat' | null
  discount_value: number
  discount_amount: number
  tax_rate: number
  tax_amount: number
  total: number
  mydata_mark?: string | null
  mydata_status?: string
  mydata_error?: string | null
  created_at: string
  updated_at: string
}

export interface InvoiceItem {
  id: string
  invoice_id: string
  description: string
  quantity: number
  unit_price: number
  total: number
  sort_order: number
}

export async function getInvoices(status?: string): Promise<Invoice[]> {
  if (status) {
    return db.query('SELECT * FROM invoices WHERE status = ? ORDER BY created_at DESC', [status]) as Promise<Invoice[]>
  }
  return db.query('SELECT * FROM invoices ORDER BY created_at DESC') as Promise<Invoice[]>
}

export async function getInvoiceItems(invoiceId: string): Promise<InvoiceItem[]> {
  return db.query('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order', [invoiceId]) as Promise<InvoiceItem[]>
}

export async function getNextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear()
  // Find the highest numeric suffix among existing invoices to avoid duplicates.
  // COUNT(*) would produce gaps/duplicates if any invoices were deleted.
  const rows = await db.query(`SELECT number FROM invoices`) as { number: string }[]
  let maxNum = 0
  for (const row of rows) {
    const m = row.number.match(/(\d+)$/)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > maxNum) maxNum = n
    }
  }
  return `INV-${year}-${String(maxNum + 1).padStart(3, '0')}`
}

export async function upsertInvoice(inv: Partial<Invoice> & { number: string }, items: Omit<InvoiceItem, 'invoice_id'>[]): Promise<string> {
  const id = inv.id ?? uuid()

  // Calc totals
  const subtotal = items.reduce((s, it) => s + it.total, 0)
  const discountType  = inv.discount_type  ?? null
  const discountValue = inv.discount_value ?? 0
  const discountAmount = discountType === 'percent'
    ? subtotal * discountValue / 100
    : discountType === 'flat' ? Math.min(discountValue, subtotal) : 0
  const afterDiscount = subtotal - discountAmount
  const taxRate  = inv.tax_rate ?? 0
  const taxAmount = afterDiscount * taxRate / 100
  const total = afterDiscount + taxAmount

  await db.run(
    `INSERT INTO invoices (id, number, document_type, customer_id, customer_name, customer_address, status, issue_date, due_date, notes, subtotal, discount_type, discount_value, discount_amount, tax_rate, tax_amount, total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       number=excluded.number, document_type=excluded.document_type, customer_id=excluded.customer_id, customer_name=excluded.customer_name,
       customer_address=excluded.customer_address, status=excluded.status, issue_date=excluded.issue_date,
       due_date=excluded.due_date, notes=excluded.notes,
       subtotal=excluded.subtotal, discount_type=excluded.discount_type, discount_value=excluded.discount_value,
       discount_amount=excluded.discount_amount, tax_rate=excluded.tax_rate, tax_amount=excluded.tax_amount, total=excluded.total,
       updated_at=datetime('now'), synced=0`,
    [id, inv.number, inv.document_type ?? 'invoice', inv.customer_id ?? null, inv.customer_name ?? null, inv.customer_address ?? null,
     inv.status ?? 'draft', inv.issue_date ?? null, inv.due_date ?? null, inv.notes ?? null,
     subtotal, discountType, discountValue, discountAmount, taxRate, taxAmount, total]
  )
  await queueSync('invoices', id, 'upsert')

  // Replace all items
  const existing = await db.query('SELECT id FROM invoice_items WHERE invoice_id = ?', [id]) as { id: string }[]
  for (const ex of existing) {
    await db.run('DELETE FROM invoice_items WHERE id = ?', [ex.id])
    await queueSync('invoice_items', ex.id, 'delete')
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const itemId = item.id ?? uuid()
    await db.run(
      `INSERT INTO invoice_items (id, invoice_id, description, quantity, unit_price, total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [itemId, id, item.description, item.quantity, item.unit_price, item.total, i]
    )
    await queueSync('invoice_items', itemId, 'upsert')
  }

  return id
}

export async function submitInvoiceToMydata(inv: Invoice, items: Omit<InvoiceItem, 'invoice_id'>[]): Promise<{ success: boolean; error?: string }> {
  const s = await getSettings()
  const companyVat   = s?.company_vat   ?? ''
  const mydataUserId = s?.mydata_user_id ?? ''
  const mydataApiKey = s?.mydata_api_key ?? ''

  if (!companyVat || !mydataUserId || !mydataApiKey) {
    const err = 'Missing myDATA credentials. Go to Settings → myDATA / ΑΑΔΕ.'
    await db.run(
      `UPDATE invoices SET mydata_status = 'failed', mydata_error = ?, updated_at = datetime('now') WHERE id = ?`,
      [err, inv.id]
    )
    return { success: false, error: err }
  }

  let customerVat = ''
  if (inv.customer_id) {
    const cust = await db.get('SELECT vat_number FROM customers WHERE id = ?', [inv.customer_id]) as { vat_number?: string } | undefined
    customerVat = cust?.vat_number ?? ''
  }

  const subtotal  = items.reduce((s, it) => s + it.total, 0)
  const taxAmount = inv.tax_amount
  const total     = inv.total

  try {
    const result = await submitToMydata({
      invoice: {
        number:        inv.number,
        issue_date:    inv.issue_date ?? null,
        document_type: inv.document_type ?? 'invoice',
        subtotal,
        tax_amount:    taxAmount,
        total,
      },
      lineItems: items,
      companyVat,
      customerVat,
      mydataUserId,
      mydataApiKey,
    })
    if (result.success && result.mark) {
      await db.run(
        `UPDATE invoices SET mydata_mark = ?, mydata_status = 'submitted', mydata_error = NULL, updated_at = datetime('now') WHERE id = ?`,
        [result.mark, inv.id]
      )
      return { success: true }
    } else {
      const err = result.error ?? 'Unknown error'
      await db.run(
        `UPDATE invoices SET mydata_status = 'failed', mydata_error = ?, updated_at = datetime('now') WHERE id = ?`,
        [err, inv.id]
      )
      return { success: false, error: err }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.run(
      `UPDATE invoices SET mydata_status = 'failed', mydata_error = ?, updated_at = datetime('now') WHERE id = ?`,
      [msg, inv.id]
    )
    return { success: false, error: msg }
  }
}

export async function deleteInvoice(id: string): Promise<void> {
  const items = await db.query('SELECT id FROM invoice_items WHERE invoice_id = ?', [id]) as { id: string }[]
  for (const it of items) {
    await queueSync('invoice_items', it.id, 'delete')
  }
  await db.run('DELETE FROM invoices WHERE id = ?', [id])
  await queueSync('invoices', id, 'delete')
}

// ── Inventory ──────────────────────────────────────────────────────────────

export interface InventoryItem {
  id: string
  name: string
  code: string | null
  unit: string
  price: number
  notes: string | null
  created_at: string
  updated_at: string
}

export async function getInventory(search?: string): Promise<InventoryItem[]> {
  if (search) {
    const q = `%${search}%`
    return db.query('SELECT * FROM inventory WHERE name LIKE ? OR code LIKE ? ORDER BY name', [q, q]) as Promise<InventoryItem[]>
  }
  return db.query('SELECT * FROM inventory ORDER BY name') as Promise<InventoryItem[]>
}

export async function upsertInventoryItem(item: Partial<InventoryItem> & { name: string }): Promise<string> {
  const id = item.id ?? uuid()
  await db.run(
    `INSERT INTO inventory (id, name, code, unit, price, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, code=excluded.code, unit=excluded.unit,
       price=excluded.price, notes=excluded.notes,
       updated_at=datetime('now'), synced=0`,
    [id, item.name, item.code ?? null, item.unit ?? 'τεμ.', item.price ?? 0, item.notes ?? null]
  )
  await queueSync('inventory', id, 'upsert')
  return id
}

export async function deleteInventoryItem(id: string): Promise<void> {
  await db.run('DELETE FROM inventory WHERE id = ?', [id])
  await queueSync('inventory', id, 'delete')
}

// ── Offers ─────────────────────────────────────────────────────────────────

export interface Offer {
  id: string
  number: string
  customer_id: string | null
  customer_name: string | null
  customer_address: string | null
  status: 'pending' | 'accepted' | 'rejected'
  issue_date: string | null
  expiry_date: string | null
  notes: string | null
  subtotal: number
  discount_type: 'percent' | 'flat' | null
  discount_value: number
  discount_amount: number
  tax_rate: number
  tax_amount: number
  total: number
  created_at: string
  updated_at: string
}

export interface OfferItem {
  id: string
  offer_id: string
  description: string
  quantity: number
  unit_price: number
  total: number
  sort_order: number
}

export async function getOffersByCustomer(customerId: string): Promise<Offer[]> {
  return db.query('SELECT * FROM offers WHERE customer_id = ? ORDER BY created_at DESC', [customerId]) as Promise<Offer[]>
}

export async function getOffers(status?: string): Promise<Offer[]> {
  if (status) {
    return db.query('SELECT * FROM offers WHERE status = ? ORDER BY created_at DESC', [status]) as Promise<Offer[]>
  }
  return db.query('SELECT * FROM offers ORDER BY created_at DESC') as Promise<Offer[]>
}

export async function getOfferItems(offerId: string): Promise<OfferItem[]> {
  return db.query('SELECT * FROM offer_items WHERE offer_id = ? ORDER BY sort_order', [offerId]) as Promise<OfferItem[]>
}

export async function getNextOfferNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const count = ((await db.get('SELECT COUNT(*) as n FROM offers') as { n: number }).n) + 1
  return `${year}-${String(count).padStart(3, '0')}`
}

export async function upsertOffer(off: Partial<Offer> & { number: string }, items: Omit<OfferItem, 'offer_id'>[]): Promise<string> {
  const id = off.id ?? uuid()

  const subtotal = items.reduce((s, it) => s + it.total, 0)
  const discountType  = off.discount_type  ?? null
  const discountValue = off.discount_value ?? 0
  const discountAmount = discountType === 'percent'
    ? subtotal * discountValue / 100
    : discountType === 'flat' ? Math.min(discountValue, subtotal) : 0
  const afterDiscount = subtotal - discountAmount
  const taxRate  = off.tax_rate ?? 0
  const taxAmount = afterDiscount * taxRate / 100
  const total = afterDiscount + taxAmount

  await db.run(
    `INSERT INTO offers (id, number, customer_id, customer_name, customer_address, status, issue_date, expiry_date, notes, subtotal, discount_type, discount_value, discount_amount, tax_rate, tax_amount, total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       number=excluded.number, customer_id=excluded.customer_id, customer_name=excluded.customer_name,
       customer_address=excluded.customer_address, status=excluded.status, issue_date=excluded.issue_date,
       expiry_date=excluded.expiry_date, notes=excluded.notes,
       subtotal=excluded.subtotal, discount_type=excluded.discount_type, discount_value=excluded.discount_value,
       discount_amount=excluded.discount_amount, tax_rate=excluded.tax_rate, tax_amount=excluded.tax_amount, total=excluded.total,
       updated_at=datetime('now'), synced=0`,
    [id, off.number, off.customer_id ?? null, off.customer_name ?? null, off.customer_address ?? null,
     off.status ?? 'pending', off.issue_date ?? null, off.expiry_date ?? null, off.notes ?? null,
     subtotal, discountType, discountValue, discountAmount, taxRate, taxAmount, total]
  )
  await queueSync('offers', id, 'upsert')

  const existing = await db.query('SELECT id FROM offer_items WHERE offer_id = ?', [id]) as { id: string }[]
  for (const ex of existing) {
    await db.run('DELETE FROM offer_items WHERE id = ?', [ex.id])
    await queueSync('offer_items', ex.id, 'delete')
  }
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const itemId = item.id ?? uuid()
    await db.run(
      `INSERT INTO offer_items (id, offer_id, description, quantity, unit_price, total, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [itemId, id, item.description, item.quantity, item.unit_price, item.total, i]
    )
    await queueSync('offer_items', itemId, 'upsert')
  }

  return id
}

export async function deleteOffer(id: string): Promise<void> {
  const items = await db.query('SELECT id FROM offer_items WHERE offer_id = ?', [id]) as { id: string }[]
  for (const it of items) {
    await queueSync('offer_items', it.id, 'delete')
  }
  await db.run('DELETE FROM offers WHERE id = ?', [id])
  await queueSync('offers', id, 'delete')
}

// ── Sync queue ─────────────────────────────────────────────────────────────

async function queueSync(table: string, id: string, op: string): Promise<void> {
  await db.run(
    'INSERT OR REPLACE INTO sync_queue (table_name, record_id, operation) VALUES (?, ?, ?)',
    [table, id, op]
  )
}
