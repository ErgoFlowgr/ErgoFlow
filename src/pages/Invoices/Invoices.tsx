import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ipc, isElectron } from '../../lib/electron'
import { db } from '../../lib/db-driver'
import { useTranslation } from 'react-i18next'
import {
  getInvoices, getInvoiceItems, getNextInvoiceNumber, upsertInvoice, deleteInvoice,
  submitInvoiceToMydata, getCustomers, getSettings, getInventory, getOfferItems, uuid,
  type Invoice, type InvoiceItem, type Customer, type Settings, type InventoryItem,
} from '../../lib/db'

type FilterType = 'all' | 'draft' | 'pending' | 'paid'

interface LineItem {
  id: string
  description: string
  quantity: number
  unit_price: number
  total: number
}

const emptyLine = (): LineItem => ({ id: uuid(), description: '', quantity: 1, unit_price: 0, total: 0 })

function formatCurrency(n: number) {
  return n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR' })
}

function buildInvoiceHtml(inv: Invoice, items: InvoiceItem[], settings: Settings | null, customerVat?: string): string {
  const company   = settings?.company_name ?? ''
  const ownerName = settings?.owner_name   ?? ''
  const phone     = settings?.phone        ?? ''
  const phone2    = settings?.phone2       ?? ''
  const address   = settings?.address      ?? ''
  const workType  = settings?.work_type    ?? ''
  const isReceipt = inv.document_type === 'receipt'
  const bannerColor = isReceipt ? '#1a6b3a' : '#1a3a6b'
  const docTitle = isReceipt ? 'ΑΠΟΔΕΙΞΗ / RECEIPT' : 'ΤΙΜΟΛΟΓΙΟ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ'
  const totalsHeaderColor = isReceipt ? '#1a6b3a' : '#1a3a6b'

  const rows = items.map(it => `
    <tr>
      <td class="td-desc">${it.description}</td>
      <td class="td-center">${it.quantity}</td>
      <td class="td-right">${it.unit_price.toFixed(2)} €</td>
      <td class="td-right">${it.total.toFixed(2)} €</td>
    </tr>`).join('')

  return `<!DOCTYPE html>
<html lang="el"><head><meta charset="UTF-8"><title>${inv.number}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #222; background: #fff; padding: 30px 40px; }

  /* Top banner */
  .banner { background: ${bannerColor}; color: #fff; padding: 18px 24px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0; }
  .banner-company { font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
  .banner-type { font-size: 15px; font-weight: 600; text-align: right; }
  .banner-number { font-size: 12px; opacity: 0.8; margin-top: 2px; }

  /* Info row */
  .info-row { display: flex; border: 1px solid #ccc; border-top: none; margin-bottom: 20px; }
  .info-box { flex: 1; padding: 12px 16px; }
  .info-box + .info-box { border-left: 1px solid #ccc; }
  .info-box h3 { font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 0.8px; margin-bottom: 6px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  .info-box p { font-size: 13px; line-height: 1.6; }
  .info-box .name { font-weight: 700; font-size: 14px; }

  /* Dates strip */
  .dates-strip { display: flex; background: #f0f4fb; border: 1px solid #c5d3e8; margin-bottom: 20px; }
  .date-cell { flex: 1; padding: 8px 16px; }
  .date-cell + .date-cell { border-left: 1px solid #c5d3e8; }
  .date-label { font-size: 10px; text-transform: uppercase; color: #1a3a6b; font-weight: 700; letter-spacing: 0.5px; }
  .date-value { font-size: 13px; font-weight: 600; margin-top: 2px; }

  /* Items table */
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  table.items thead tr { background: ${bannerColor}; color: #fff; }
  table.items th { padding: 9px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  table.items th:first-child { text-align: left; }
  table.items th:not(:first-child) { text-align: right; }
  table.items tbody tr:nth-child(even) { background: #f7f9fc; }
  table.items td { padding: 9px 12px; border-bottom: 1px solid #e5e9f0; }
  .td-desc { text-align: left; }
  .td-center { text-align: right; }
  .td-right { text-align: right; }

  /* Totals */
  .bottom { display: flex; justify-content: flex-end; margin-bottom: 20px; }
  .totals-box { width: 260px; border: 1px solid #c5d3e8; }
  .totals-box .t-row { display: flex; justify-content: space-between; padding: 7px 14px; border-bottom: 1px solid #e5e9f0; font-size: 13px; }
  .totals-box .t-row:last-child { border-bottom: none; background: ${totalsHeaderColor}; color: #fff; font-weight: 700; font-size: 15px; }
  .totals-box .t-label { color: inherit; }
  .totals-box .t-value { font-weight: 600; }

  /* Notes */
  .notes-box { border: 1px solid #e0e0e0; padding: 10px 14px; font-size: 12px; color: #555; margin-bottom: 20px; background: #fafafa; }
  .notes-box strong { color: #333; }

  /* Footer */
  .footer { text-align: center; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 14px; }

  @media print { body { padding: 10px 20px; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
</style></head><body>

<!-- Banner -->
<div class="banner">
  <div style="display:flex;align-items:center;gap:14px">
    ${settings?.company_logo ? `<img src="${settings.company_logo}" style="max-height:60px;max-width:120px;object-fit:contain;flex-shrink:0" />` : ''}
    <div>
      <div class="banner-company">${company || 'Η Εταιρεία Σας'}</div>
      ${workType ? `<div style="font-size:12px;opacity:0.8;margin-top:3px">${workType}</div>` : ''}
    </div>
  </div>
  <div style="text-align:right">
    <div class="banner-type">${docTitle}</div>
    <div class="banner-number">${inv.number}</div>
  </div>
</div>

<!-- Seller / Buyer -->
<div class="info-row">
  <div class="info-box">
    <h3>Πωλητής / Seller</h3>
    <p class="name">${company || '—'}</p>
    ${ownerName ? `<p>${ownerName}</p>` : ''}
    ${address ? `<p>${address}</p>` : ''}
    ${phone ? `<p>Κιν: ${phone}</p>` : ''}
    ${phone2 ? `<p>Σταθ: ${phone2}</p>` : ''}
  </div>
  <div class="info-box">
    <h3>Αγοραστής / Bill To</h3>
    <p class="name">${inv.customer_name ?? '—'}</p>
    ${inv.customer_address ? `<p>${inv.customer_address}</p>` : ''}
    ${customerVat ? `<p>ΑΦΜ: ${customerVat}</p>` : ''}
  </div>
</div>

<!-- Dates -->
<div class="dates-strip">
  <div class="date-cell">
    <div class="date-label">Αριθμός / Invoice #</div>
    <div class="date-value">${inv.number}</div>
  </div>
  <div class="date-cell">
    <div class="date-label">Ημερομηνία / Date</div>
    <div class="date-value">${inv.issue_date ?? '—'}</div>
  </div>
  <div class="date-cell">
    <div class="date-label">Λήξη / Due Date</div>
    <div class="date-value">${inv.due_date ?? '—'}</div>
  </div>
</div>

<!-- Items -->
<table class="items">
  <thead>
    <tr>
      <th style="text-align:left;width:50%">Περιγραφή / Description</th>
      <th>Ποσότητα / Qty</th>
      <th>Τιμή Μονάδας / Unit Price</th>
      <th>Αξία / Amount</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<!-- Totals -->
<div class="bottom">
  <div class="totals-box">
    <div class="t-row"><span class="t-label">Υποσύνολο / Subtotal</span><span class="t-value">${inv.subtotal.toFixed(2)} €</span></div>
    ${inv.discount_amount > 0 ? `<div class="t-row" style="color:#c0392b"><span class="t-label">Έκπτωση / Discount${inv.discount_type === 'percent' ? ` (${inv.discount_value}%)` : ''}</span><span class="t-value">-${inv.discount_amount.toFixed(2)} €</span></div>` : ''}
    ${inv.tax_rate > 0 ? `<div class="t-row"><span class="t-label">ΦΠΑ ${inv.tax_rate}% / VAT</span><span class="t-value">${inv.tax_amount.toFixed(2)} €</span></div>` : ''}
    <div class="t-row"><span class="t-label">ΣΥΝΟΛΟ / TOTAL</span><span class="t-value">${inv.total.toFixed(2)} €</span></div>
  </div>
</div>

${inv.notes ? `<div class="notes-box"><strong>Σημειώσεις / Notes:</strong> ${inv.notes}</div>` : ''}

${inv.mydata_mark ? `<div style="margin-bottom:14px;padding:8px 14px;border:1px solid #2a6b3a;border-radius:4px;background:#f0fff4;font-size:12px;color:#1a4a2a;display:flex;align-items:center;gap:8px"><strong>ΜΑΡΚ myDATA:</strong> <span style="font-family:monospace;font-weight:700;font-size:13px">${inv.mydata_mark}</span></div>` : ''}

<!-- Footer -->
<div class="footer">Σας ευχαριστούμε για την εμπιστοσύνη σας &bull; Thank you for your business</div>

</body></html>`
}

async function printInvoice(inv: Invoice, items: InvoiceItem[], settings: Settings | null, customerVat?: string) {
  const html = buildInvoiceHtml(inv, items, settings, customerVat)
  if (isElectron) {
    await ipc.printInvoice(html)
  } else {
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }
}

export default function Invoices() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const handledNavKey = useRef<string | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')
  const [showTotals, setShowTotals] = useState(false)
  const [yearFilter, setYearFilter] = useState<number | 'prev'>(new Date().getFullYear())
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [items, setItems] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<InventoryItem[]>([])
  const [showCatalog, setShowCatalog] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')

  // Form state
  const [number, setNumber] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [showCustomerList, setShowCustomerList] = useState(false)
  const [customerAddress, setCustomerAddress] = useState('')
  const [status, setStatus] = useState<Invoice['status']>('draft')
  const [issueDate, setIssueDate] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [taxRate, setTaxRate] = useState(24)
  const [docType, setDocType] = useState<'invoice' | 'receipt'>('invoice')
  const [discountType, setDiscountType] = useState<'percent' | 'flat' | null>(null)
  const [discountValue, setDiscountValue] = useState(0)
  const [notes, setNotes] = useState('')

  const loadData = async () => {
    try { setInvoices(await getInvoices()) } catch { /* table may not exist yet */ }
    setCustomers(await getCustomers())
    setSettings(await getSettings())
    try { setCatalog(await getInventory()) } catch { /* ignore */ }
  }

  const load = async () => {
    // If this nav key was already handled (navigate-clear causes a second fire), skip
    const currentKey = location.key
    const state = location.state as { invoiceId?: string; fromJob?: { customer_id: string | null; customer_name: string | null; description: string | null; notes: string | null; job_id: string }; fromOffer?: { customer_id: string | null; customer_name: string | null; customer_address: string | null; offer_number: string; offer_id: string } } | null
    const hasNavState = !!(state?.invoiceId || state?.fromJob || state?.fromOffer)

    let loadedInvoices: Invoice[] = []
    try { loadedInvoices = await getInvoices(); setInvoices(loadedInvoices) } catch { /* table may not exist yet */ }
    setCustomers(await getCustomers())
    setSettings(await getSettings())
    try { setCatalog(await getInventory()) } catch { /* ignore */ }

    if (!hasNavState || handledNavKey.current === currentKey) return
    handledNavKey.current = currentKey
    navigate('/invoices', { replace: true, state: null })

    if (state?.invoiceId) {
      const target = loadedInvoices.find(i => i.id === state.invoiceId)
      if (target) {
        const existingItems = await getInvoiceItems(target.id)
        setEditing(target); setNumber(target.number); setCustomerId(target.customer_id ?? ''); setCustomerName(target.customer_name ?? '')
        setCustomerAddress(target.customer_address ?? ''); setStatus(target.status); setIssueDate(target.issue_date ?? '')
        setDueDate(target.due_date ?? ''); setDocType(target.document_type ?? 'invoice'); setTaxRate(target.tax_rate)
        setDiscountType(target.discount_type ?? null); setDiscountValue(target.discount_value ?? 0); setNotes(target.notes ?? '')
        setItems(existingItems.length > 0 ? existingItems.map(it => ({ id: it.id, description: it.description, quantity: it.quantity, unit_price: it.unit_price, total: it.total })) : [emptyLine()])
        setShowModal(true)
      }
    } else if (state?.fromJob) {
      const j = state.fromJob
      let num = ''
      try { num = await getNextInvoiceNumber() } catch { num = `INV-${new Date().getFullYear()}-001` }
      setEditing(null); setNumber(num); setCustomerId(j.customer_id ?? ''); setCustomerName(j.customer_name ?? '')
      setCustomerAddress(''); setStatus('draft'); setIssueDate(new Date().toISOString().slice(0, 10))
      setDueDate(''); setDocType('invoice'); setTaxRate(24); setDiscountType(null); setDiscountValue(0)
      setNotes(j.notes ?? '')
      setItems(j.description?.trim() ? [{ id: uuid(), description: j.description.trim(), quantity: 1, unit_price: 0, total: 0 }] : [emptyLine()])
      setShowModal(true)
    } else if (state?.fromOffer) {
      const o = state.fromOffer
      let num = ''
      try { num = await getNextInvoiceNumber() } catch { num = `INV-${new Date().getFullYear()}-001` }
      setEditing(null); setNumber(num); setCustomerId(o.customer_id ?? ''); setCustomerName(o.customer_name ?? '')
      setCustomerAddress(o.customer_address ?? ''); setStatus('draft'); setIssueDate(new Date().toISOString().slice(0, 10))
      setDueDate(''); setDocType('invoice'); setTaxRate(24); setDiscountType(null); setDiscountValue(0)
      setNotes('')
      const offerItems = await getOfferItems(o.offer_id)
      setItems(offerItems.length > 0
        ? offerItems.map(it => ({ id: uuid(), description: it.description, quantity: it.quantity, unit_price: it.unit_price, total: it.total }))
        : [emptyLine()])
      setShowModal(true)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [location.key])

  const currentYear = new Date().getFullYear()
  const hasPrevYears = invoices.some(i => i.issue_date && new Date(i.issue_date).getFullYear() < currentYear)
  const yearFiltered = yearFilter === 'prev'
    ? invoices.filter(i => !i.issue_date || new Date(i.issue_date).getFullYear() < currentYear)
    : invoices.filter(i => !i.issue_date || new Date(i.issue_date).getFullYear() === yearFilter)
  const filtered = filter === 'all' ? yearFiltered : yearFiltered.filter(i => i.status === filter)
  const counts = {
    all: yearFiltered.length,
    draft: yearFiltered.filter(i => i.status === 'draft').length,
    pending: yearFiltered.filter(i => i.status === 'pending').length,
    paid: yearFiltered.filter(i => i.status === 'paid').length,
  }

  const filteredNet = filtered.reduce((s, i) => s + (i.subtotal ?? 0), 0)
  const filteredVat = filtered.reduce((s, i) => s + ((i.total ?? 0) - (i.subtotal ?? 0)), 0)
  const filteredTotal = filtered.reduce((s, i) => s + (i.total ?? 0), 0)

  const subtotal = items.reduce((s, it) => s + it.total, 0)
  const discountAmount = discountType === 'percent'
    ? subtotal * discountValue / 100
    : discountType === 'flat' ? Math.min(discountValue, subtotal) : 0
  const afterDiscount = subtotal - discountAmount
  const taxAmount = afterDiscount * taxRate / 100
  const total = afterDiscount + taxAmount

  const openNew = async () => {
    let num = ''
    try { num = await getNextInvoiceNumber() } catch { num = `INV-${new Date().getFullYear()}-001` }
    setEditing(null)
    setNumber(num)
    setCustomerId('')
    setCustomerName('')
    setCustomerAddress('')
    setStatus('draft')
    setIssueDate(new Date().toISOString().slice(0, 10))
    setDueDate('')
    setDocType('invoice')
    setTaxRate(24)
    setDiscountType(null)
    setDiscountValue(0)
    setNotes('')
    setItems([emptyLine()])
    setShowModal(true)
  }

  const openEdit = async (inv: Invoice) => {
    const existingItems = await getInvoiceItems(inv.id)
    setEditing(inv)
    setNumber(inv.number)
    setCustomerId(inv.customer_id ?? '')
    setCustomerName(inv.customer_name ?? '')
    setCustomerAddress(inv.customer_address ?? '')
    setStatus(inv.status)
    setIssueDate(inv.issue_date ?? '')
    setDueDate(inv.due_date ?? '')
    setDocType(inv.document_type ?? 'invoice')
    setTaxRate(inv.tax_rate)
    setDiscountType(inv.discount_type ?? null)
    setDiscountValue(inv.discount_value ?? 0)
    setNotes(inv.notes ?? '')
    setItems(existingItems.length > 0
      ? existingItems.map(it => ({ id: it.id, description: it.description, quantity: it.quantity, unit_price: it.unit_price, total: it.total }))
      : [emptyLine()])
    setShowModal(true)
  }

  const closeModal = () => { setShowModal(false); setEditing(null); setShowCustomerList(false) }

  const updateItem = (idx: number, field: keyof LineItem, value: string | number) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it
      const updated = { ...it, [field]: value }
      updated.total = updated.quantity * updated.unit_price
      return updated
    }))
  }

  const filteredCustomers = customers.filter(c =>
    customerName.trim() === '' || c.name.toLowerCase().includes(customerName.toLowerCase())
  )

  const handleSave = async () => {
    if (!number.trim()) return
    setSaving(true)
    try {
      const invData: Partial<Invoice> & { number: string } = {
        id: editing?.id,
        number: number.trim(),
        customer_id: (customerId && customers.some(c => c.id === customerId)) ? customerId : null,
        customer_name: customerName.trim() || null,
        customer_address: customerAddress || null,
        status,
        issue_date: issueDate || null,
        due_date: dueDate || null,
        document_type: docType,
        tax_rate: taxRate,
        discount_type: discountType,
        discount_value: discountValue,
        notes: notes || null,
      }
      const lineItems = items.filter(it => it.description.trim()).map(it => ({
        id: it.id,
        description: it.description,
        quantity: it.quantity,
        unit_price: it.unit_price,
        total: it.total,
        sort_order: 0,
      }))
      await upsertInvoice(invData, lineItems)
      await loadData()
      closeModal()
    } catch (err) {
      alert('Σφάλμα αποθήκευσης: ' + String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteInvoice(id)
    setDeleteConfirm(null)
    await loadData()
  }

  const getCustomerVat = (inv: Invoice) =>
    customers.find(c => c.id === inv.customer_id)?.vat_number ?? undefined

  const handlePrint = async (inv: Invoice) => {
    const invItems = await getInvoiceItems(inv.id)
    await printInvoice(inv, invItems, settings, getCustomerVat(inv))
  }

  const handleSavePdf = async (inv: Invoice) => {
    const invItems = await getInvoiceItems(inv.id)
    const html = buildInvoiceHtml(inv, invItems, settings, getCustomerVat(inv))
    const name = `${inv.number}${inv.customer_name ? '-' + inv.customer_name : ''}`
    if (isElectron) {
      await ipc.savePdf(html, name)
    } else {
      // Mobile: share via native share sheet
      const { Share } = await import('@capacitor/share')
      await Share.share({ title: name, text: html, dialogTitle: 'Κοινοποίηση τιμολογίου' })
    }
  }

  const handleShareMessenger = async (inv: Invoice, messenger: 'whatsapp' | 'viber') => {
    const invItems = await getInvoiceItems(inv.id)
    const html = buildInvoiceHtml(inv, invItems, settings, getCustomerVat(inv))
    const filename = `${inv.number}${inv.customer_name ? '-' + inv.customer_name : ''}`
    if (isElectron) {
      const filePath = await ipc.saveDesktopPdf(html, filename)
      const scheme = messenger === 'whatsapp' ? 'whatsapp://send' : 'viber://forward'
      await ipc.openExternal(scheme)
      const pdfName = filePath.split('\\').pop() ?? filename
      setTimeout(() => alert(`Το PDF αποθηκεύτηκε στην Επιφάνεια Εργασίας:\n${pdfName}\n\nΣύρε το αρχείο στο παράθυρο του ${messenger === 'whatsapp' ? 'WhatsApp' : 'Viber'}.`), 800)
    } else {
      // Mobile: native share sheet includes WhatsApp and Viber automatically
      const { Share } = await import('@capacitor/share')
      await Share.share({ title: filename, text: html, dialogTitle: 'Κοινοποίηση μέσω' })
    }
  }

  const statusColor = (s: Invoice['status']) =>
    s === 'paid'    ? 'bg-emerald-500/20 text-emerald-400' :
    s === 'pending' ? 'bg-blue-500/20 text-blue-400' :
    'bg-gray-500/20 text-gray-400'

  const handleMydataSubmit = async (inv: Invoice, e: React.MouseEvent) => {
    e.stopPropagation()
    const isInvoice = inv.document_type !== 'receipt'
    const customer = customers.find(c => c.id === inv.customer_id)
    const hasVat = !!(customer?.vat_number?.trim())
    const docLabel = isInvoice ? t('invoices.docInvoice') : t('invoices.docReceipt')

    let message = t('invoices.mydataConfirm', { doc: docLabel, number: inv.number })
    if (isInvoice && !hasVat) {
      message = t('invoices.mydataConfirmNoVat')
    }

    const confirmed = window.confirm(message)
    if (!confirmed) return
    await db.run(
      `UPDATE invoices SET mydata_status = 'pending', updated_at = datetime('now') WHERE id = ?`,
      [inv.id]
    )
    const invItems = await getInvoiceItems(inv.id)
    await submitInvoiceToMydata(inv, invItems)
    await loadData()
  }

  const filters: FilterType[] = ['all', 'draft', 'pending', 'paid']

  return (
    <div className="px-3 py-4 sm:p-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('invoices.title')}</h1>
          <p className="text-gray-400 text-sm mt-0.5">{invoices.length} {t('invoices.subtitle')}</p>
        </div>
        <button className="btn-primary" onClick={openNew}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('invoices.newInvoice')}
        </button>
      </div>

      {/* Year toggle */}
      {hasPrevYears && (
        <div className="flex gap-2 mb-3">
          <button
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${yearFilter !== 'prev' ? 'bg-brand-500 text-white' : 'bg-surface-800 text-gray-400 hover:text-white'}`}
            onClick={() => setYearFilter(currentYear)}
          >
            {currentYear}
          </button>
          <button
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${yearFilter === 'prev' ? 'bg-surface-600 text-white' : 'bg-surface-800 text-gray-400 hover:text-white'}`}
            onClick={() => setYearFilter('prev')}
          >
            {t('invoices.previousYears')}
          </button>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {filters.map(f => (
          <button
            key={f}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f ? 'bg-brand-500 text-white' : 'bg-surface-800 text-gray-400 hover:text-white'
            }`}
            onClick={() => setFilter(f)}
          >
            {t(`invoices.filter_${f}`)} <span className="ml-1 opacity-60">({counts[f]})</span>
          </button>
        ))}
      </div>

      {/* Totals summary */}
      {filtered.length > 0 && (
        <div className="mb-4">
          <button
            className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-300 transition-colors mb-2"
            onClick={() => setShowTotals(p => !p)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {showTotals
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              }
            </svg>
            {showTotals ? t('invoices.hideAmounts') : t('invoices.showAmounts')}
          </button>
          {showTotals && (
            <div className="flex gap-3">
              <div className="flex-1 bg-surface-800 border border-surface-600 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-500 mb-0.5">{t('invoices.netValue')}</p>
                <p className="text-lg font-semibold text-white">{filteredNet.toFixed(2)} €</p>
              </div>
              <div className="flex-1 bg-surface-800 border border-surface-600 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-500 mb-0.5">{t('invoices.vat')}</p>
                <p className="text-lg font-semibold text-yellow-400">{filteredVat.toFixed(2)} €</p>
              </div>
              <div className="flex-1 bg-surface-800 border border-brand-500/40 rounded-xl px-4 py-3">
                <p className="text-xs text-gray-500 mb-0.5">{t('invoices.total')}</p>
                <p className="text-lg font-semibold text-brand-400">{filteredTotal.toFixed(2)} €</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Invoice list */}
      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <svg className="w-12 h-12 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-500">{t('invoices.noInvoices')}</p>
          <p className="text-gray-600 text-sm mt-1">{t('invoices.noInvoicesSub')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(inv => (
            <div
              key={inv.id}
              className="bg-surface-800 border border-surface-600 rounded-xl p-4 flex flex-wrap items-center gap-4 hover:border-surface-500 transition-colors cursor-pointer"
              onClick={() => openEdit(inv)}
            >
              <div className="w-1 self-stretch rounded-full bg-brand-500/40" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{inv.number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(inv.status)}`}>
                    {t(`invoices.status_${inv.status}`)}
                  </span>
                  {inv.mydata_status === 'submitted' && (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-500/20 text-emerald-400">
                      myDATA ✓
                    </span>
                  )}
                  {inv.mydata_status === 'failed' && (
                    <span className="flex items-center gap-1">
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-500/20 text-red-400">
                        myDATA ✗
                      </span>
                      <button
                        className="text-gray-500 hover:text-yellow-400 p-0.5 rounded transition-colors"
                        onClick={e => handleMydataSubmit(inv, e)}
                        title="Retry myDATA submission"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      </button>
                    </span>
                  )}
                </div>
                <p className="text-gray-400 text-sm truncate mt-0.5">{inv.customer_name ?? '—'}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-sm">{formatCurrency(inv.total)}</p>
                <p className="text-gray-500 text-xs mt-0.5">{inv.issue_date ?? '—'}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                {/* Print */}
                <button
                  className="text-gray-500 hover:text-white p-1.5 rounded-lg hover:bg-surface-700 transition-colors"
                  onClick={() => handlePrint(inv)}
                  title={t('invoices.print')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                </button>
                {/* Save as PDF */}
                <button
                  className="text-gray-500 hover:text-white p-1.5 rounded-lg hover:bg-surface-700 transition-colors"
                  onClick={() => handleSavePdf(inv)}
                  title={t('invoices.savePdf')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
                {/* WhatsApp */}
                <button
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                  onClick={() => handleShareMessenger(inv, 'whatsapp')}
                  title="Κοινοποίηση στο WhatsApp"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M11.992 2C6.476 2 2 6.476 2 11.992c0 1.814.487 3.516 1.338 4.983L2 22l5.166-1.315A9.96 9.96 0 0011.992 22c5.516 0 9.992-4.476 9.992-9.992C21.984 6.476 17.508 2 11.992 2zm0 18.316a8.292 8.292 0 01-4.221-1.153l-.303-.18-3.067.781.813-2.981-.198-.314A8.324 8.324 0 013.684 11.992c0-4.585 3.731-8.316 8.308-8.316 4.585 0 8.316 3.731 8.316 8.316 0 4.577-3.731 8.324-8.316 8.324z"/>
                  </svg>
                  WA
                </button>
                {/* Viber */}
                <button
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
                  onClick={() => handleShareMessenger(inv, 'viber')}
                  title="Κοινοποίηση στο Viber"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.992 2C6.476 2 2 6.476 2 11.992c0 2.172.693 4.18 1.864 5.822L2.5 21.5l3.794-1.328A9.956 9.956 0 0011.992 22c5.516 0 9.992-4.476 9.992-9.992C21.984 6.476 17.508 2 11.992 2zm4.9 13.9c-.21.588-.942 1.176-1.596 1.26-.42.042-.966.084-3.108-.672-2.604-.966-4.284-3.612-4.41-3.78-.126-.168-1.05-1.386-1.05-2.646 0-1.26.672-1.89 1.008-2.142.336-.252.714-.336.966-.336.252 0 .462 0 .672.042.21.042.504-.084.798.588.294.672 1.008 2.31 1.092 2.478.084.168.126.378 0 .588-.126.21-.168.336-.336.504-.168.168-.336.378-.462.504-.168.168-.336.378-.168.714.168.336.756 1.26 1.638 2.058 1.134 1.008 2.1 1.344 2.394 1.47.294.126.462.084.63-.084.168-.168.714-.84.882-1.134.168-.294.378-.252.63-.168.252.084 1.638.798 1.932.966.294.168.504.252.588.378.084.168.084.672-.126 1.26z"/>
                  </svg>
                  Viber
                </button>
                {/* Submit to myDATA — all tiers */}
                {inv.mydata_status !== 'submitted' && (
                  <button
                    className="text-gray-500 hover:text-emerald-400 p-1.5 rounded-lg hover:bg-surface-700 transition-colors"
                    onClick={e => handleMydataSubmit(inv, e)}
                    title="Υποβολή myDATA"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                )}
                {/* Delete */}
                <button
                  className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-surface-700 transition-colors"
                  onClick={() => setDeleteConfirm(inv.id)}
                  title={t('invoices.delete')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-surface-600">
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-bold">{editing ? `${editing.number}` : t('invoices.newDocument')}</h2>
                <div className="flex rounded-lg overflow-hidden border border-surface-500 text-sm">
                  <button
                    className={`px-3 py-1 ${docType === 'invoice' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    onClick={() => setDocType('invoice')}
                  >{t('invoices.typeInvoice')}</button>
                  <button
                    className={`px-3 py-1 ${docType === 'receipt' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'}`}
                    onClick={() => setDocType('receipt')}
                  >{t('invoices.typeReceipt')}</button>
                </div>
              </div>
              <button className="text-gray-400 hover:text-white" onClick={closeModal}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              {/* myDATA status banner */}
              {editing && editing.mydata_mark && (
                <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-2.5">
                  <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-medium text-emerald-300">ΜΑΡΚ myDATA: <span className="font-mono font-bold">{editing.mydata_mark}</span></span>
                </div>
              )}
              {editing && editing.mydata_status === 'failed' && (
                <div className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm text-red-300">Η υποβολή στο myDATA απέτυχε.</span>
                      {editing.mydata_error && (
                        <span className="text-xs text-red-400/80 font-mono break-all">{editing.mydata_error}</span>
                      )}
                    </div>
                  </div>
                  <button
                    className="text-xs bg-red-500/20 hover:bg-red-500/40 text-red-300 rounded px-3 py-1 transition-colors whitespace-nowrap"
                    onClick={async () => {
                      await db.run(
                        `UPDATE invoices SET mydata_status = 'pending', updated_at = datetime('now') WHERE id = ?`,
                        [editing.id]
                      )
                      const invItems = await getInvoiceItems(editing.id)
                      await upsertInvoice({ ...editing, mydata_status: 'pending' }, invItems)
                      await loadData()
                      closeModal()
                    }}
                  >
                    {t('invoices.retryMydata')}
                  </button>
                </div>
              )}
              {/* Row 1: number + status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('invoices.number')}</label>
                  <input className="input w-full" value={number} onChange={e => setNumber(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('invoices.status')}</label>
                  <select className="input w-full" value={status} onChange={e => setStatus(e.target.value as Invoice['status'])}>
                    <option value="draft">{t('invoices.status_draft')}</option>
                    <option value="pending">{t('invoices.status_pending')}</option>
                    <option value="paid">{t('invoices.status_paid')}</option>
                  </select>
                </div>
              </div>

              {/* Customer combobox */}
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-xs text-gray-400 mb-1">{t('invoices.customer')}</label>
                  <input
                    className="input w-full"
                    value={customerName}
                    onChange={e => {
                      setCustomerName(e.target.value)
                      setCustomerId('')
                      setShowCustomerList(true)
                    }}
                    onFocus={() => setShowCustomerList(true)}
                    onBlur={() => setTimeout(() => setShowCustomerList(false), 150)}
                    placeholder={t('invoices.noCustomer')}
                  />
                  {showCustomerList && filteredCustomers.length > 0 && (
                    <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-surface-700 border border-surface-500 rounded-lg shadow-xl max-h-48 overflow-auto">
                      {filteredCustomers.map(c => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-surface-600 transition-colors"
                          onMouseDown={() => {
                            setCustomerId(c.id)
                            setCustomerName(c.name)
                            if (!customerAddress && c.address) setCustomerAddress(c.address)
                            setShowCustomerList(false)
                          }}
                        >
                          {c.name}
                          {c.phone && <span className="ml-2 text-gray-500 text-xs">{c.phone}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('invoices.customerAddress')}</label>
                  <input className="input w-full" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder={t('invoices.addressPlaceholder')} />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('invoices.issueDate')}</label>
                  <input type="date" className="input w-full" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('invoices.dueDate')}</label>
                  <input type="date" className="input w-full" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </div>
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-400 uppercase tracking-wider">{t('invoices.items')}</label>
                  <div className="flex items-center gap-3">
                    {catalog.length > 0 && (
                      <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => { setCatalogSearch(''); setShowCatalog(true) }}>
                        📦 {t('invoices.fromCatalog')}
                      </button>
                    )}
                    <button className="text-xs text-brand-400 hover:text-brand-300" onClick={() => setItems(p => [...p, emptyLine()])}>
                      + {t('invoices.addItem')}
                    </button>
                  </div>
                </div>
                <div className="border border-surface-600 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead className="bg-surface-700">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs text-gray-400 font-medium">{t('invoices.description')}</th>
                        <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium w-20">{t('invoices.qty')}</th>
                        <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium w-28">{t('invoices.unitPrice')}</th>
                        <th className="text-right px-3 py-2 text-xs text-gray-400 font-medium w-28">{t('invoices.lineTotal')}</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, idx) => (
                        <tr key={it.id} className="border-t border-surface-600">
                          <td className="px-2 py-1">
                            <input
                              className="bg-transparent w-full outline-none text-sm px-1"
                              value={it.description}
                              onChange={e => updateItem(idx, 'description', e.target.value)}
                              placeholder={t('invoices.descriptionPlaceholder')}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              type="text" inputMode="decimal"
                              className="bg-transparent w-full outline-none text-sm text-right px-1"
                              value={it.quantity || ''}
                              onFocus={e => { if (e.target.value === '0') e.target.value = '' }}
                              onBlur={e => { if (!e.target.value) updateItem(idx, 'quantity', 0) }}
                              onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <input
                              type="text" inputMode="decimal"
                              className="bg-transparent w-full outline-none text-sm text-right px-1"
                              value={it.unit_price || ''}
                              onFocus={e => { if (e.target.value === '0') e.target.value = '' }}
                              onBlur={e => { if (!e.target.value) updateItem(idx, 'unit_price', 0) }}
                              onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="px-3 py-1 text-right text-sm">{it.total.toFixed(2)} €</td>
                          <td className="px-2 py-1 text-center">
                            {items.length > 1 && (
                              <button className="text-gray-600 hover:text-red-400" onClick={() => setItems(p => p.filter((_, i) => i !== idx))}>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals + tax */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                <div className="w-full sm:flex-1">
                  <label className="block text-xs text-gray-400 mb-1">{t('invoices.notes')}</label>
                  <textarea className="input w-full h-20 resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('invoices.notesPlaceholder')} />
                </div>
                <div className="w-full sm:w-64 space-y-2 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>{t('invoices.subtotal')}</span>
                    <span>{subtotal.toFixed(2)} €</span>
                  </div>
                  {/* Discount */}
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-gray-400">{t('invoices.discount')}</span>
                    <div className="flex items-center gap-1">
                      <select
                        className="input py-1 text-xs"
                        value={discountType ?? ''}
                        onChange={e => setDiscountType((e.target.value as 'percent' | 'flat') || null)}
                      >
                        <option value="">{t('invoices.discountNone')}</option>
                        <option value="percent">%</option>
                        <option value="flat">€</option>
                      </select>
                      {discountType && (
                        <input
                          type="number" min="0" step="0.01"
                          className="input w-16 text-right py-1 text-xs"
                          value={discountValue}
                          onChange={e => setDiscountValue(parseFloat(e.target.value) || 0)}
                        />
                      )}
                    </div>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-red-400">
                      <span>{t('invoices.discount')} ({discountType === 'percent' ? `${discountValue}%` : `€${discountValue}`})</span>
                      <span>-{discountAmount.toFixed(2)} €</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-gray-400">{t('invoices.tax')}</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number" min="0" max="100" step="1"
                        className="input w-16 text-right py-1 text-xs"
                        value={taxRate}
                        onChange={e => setTaxRate(parseFloat(e.target.value) || 0)}
                      />
                      <span className="text-gray-400 text-xs">%</span>
                    </div>
                  </div>
                  {taxRate > 0 && (
                    <div className="flex justify-between text-gray-400">
                      <span>{t('invoices.taxAmount')}</span>
                      <span>{taxAmount.toFixed(2)} €</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t border-surface-600 pt-2">
                    <span>{t('invoices.total')}</span>
                    <span>{total.toFixed(2)} €</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-between items-center flex-wrap gap-3 p-4 sm:p-5 border-t border-surface-600">
              <button className="text-gray-400 hover:text-white text-sm" onClick={closeModal}>{t('invoices.cancel')}</button>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                {editing && (
                  <button
                    className="btn-secondary flex items-center gap-2 text-sm"
                    onClick={() => handlePrint(editing)}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                    </svg>
                    {t('invoices.print')}
                  </button>
                )}
                <button className="btn-primary" onClick={handleSave} disabled={saving || !number.trim()}>
                  {saving ? t('invoices.saving') : docType === 'receipt' ? t('invoices.saveReceipt') : t('invoices.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Catalog picker */}
      {showCatalog && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl w-full max-w-md max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-surface-600">
              <h3 className="font-semibold">{t('invoices.selectFromCatalog')}</h3>
              <button className="text-gray-400 hover:text-white" onClick={() => setShowCatalog(false)}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-3 border-b border-surface-600">
              <input
                className="input w-full text-sm"
                placeholder={t('invoices.catalogSearch')}
                value={catalogSearch}
                onChange={e => setCatalogSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="overflow-auto flex-1">
              {catalog
                .filter(it => catalogSearch === '' || it.name.toLowerCase().includes(catalogSearch.toLowerCase()) || (it.code ?? '').toLowerCase().includes(catalogSearch.toLowerCase()))
                .map(it => (
                  <button
                    key={it.id}
                    className="w-full text-left px-4 py-3 hover:bg-surface-700 border-b border-surface-700 transition-colors flex items-center justify-between"
                    onClick={() => {
                      const newItem = { id: uuid(), description: it.name, quantity: 1, unit_price: it.price, total: it.price }
                      setItems(p => {
                        const isOnlyEmptyLine = p.length === 1 && !p[0].description && p[0].unit_price === 0
                        return isOnlyEmptyLine ? [newItem] : [...p, newItem]
                      })
                      setShowCatalog(false)
                    }}
                  >
                    <div>
                      <span className="text-sm font-medium">{it.name}</span>
                      {it.code && <span className="ml-2 text-xs text-gray-500 font-mono">{it.code}</span>}
                    </div>
                    <div className="text-right shrink-0 ml-4">
                      <span className="text-sm font-semibold">{it.price.toFixed(2)} €</span>
                      <span className="text-xs text-gray-500 ml-1">/{it.unit}</span>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-bold mb-2">{t('invoices.deleteConfirm')}</h3>
            <p className="text-gray-400 text-sm mb-5">{t('invoices.deleteWarning')}</p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setDeleteConfirm(null)}>{t('invoices.cancel')}</button>
              <button className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-lg py-2 font-medium text-sm transition-colors" onClick={() => handleDelete(deleteConfirm)}>
                {t('invoices.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
