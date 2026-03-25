import { useEffect, useState } from 'react'
import { ipc } from '../../lib/electron'
import { useTranslation } from 'react-i18next'
import {
  getInvoices, getInvoiceItems, getNextInvoiceNumber, upsertInvoice, deleteInvoice,
  getCustomers, getSettings, uuid,
  type Invoice, type InvoiceItem, type Customer, type Settings,
} from '../../lib/db'

type FilterType = 'all' | 'draft' | 'sent' | 'paid'

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

async function printInvoice(inv: Invoice, items: InvoiceItem[], settings: Settings | null) {
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

  const html = `<!DOCTYPE html>
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
  <div>
    <div class="banner-company">${company || 'Η Εταιρεία Σας'}</div>
    ${workType ? `<div style="font-size:12px;opacity:0.8;margin-top:3px">${workType}</div>` : ''}
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

<!-- Footer -->
<div class="footer">Σας ευχαριστούμε για την εμπιστοσύνη σας &bull; Thank you for your business</div>

</body></html>`

  await ipc.printInvoice(html)
}

export default function Invoices() {
  const { t } = useTranslation()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Invoice | null>(null)
  const [items, setItems] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

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

  const load = async () => {
    try { setInvoices(await getInvoices()) } catch { /* table may not exist yet */ }
    setCustomers(await getCustomers())
    setSettings(await getSettings())
  }

  useEffect(() => { load() }, [])

  const filtered = filter === 'all' ? invoices : invoices.filter(i => i.status === filter)
  const counts = {
    all: invoices.length,
    draft: invoices.filter(i => i.status === 'draft').length,
    sent: invoices.filter(i => i.status === 'sent').length,
    paid: invoices.filter(i => i.status === 'paid').length,
  }

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
        customer_id: customerId || null,
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
      await load()
      closeModal()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await deleteInvoice(id)
    setDeleteConfirm(null)
    await load()
  }

  const handlePrint = async (inv: Invoice) => {
    try {
      alert('handlePrint called')
      const invItems = await getInvoiceItems(inv.id)
      await printInvoice(inv, invItems, settings)
    } catch (e) {
      alert('Print error: ' + e)
    }
  }

  const statusColor = (s: Invoice['status']) =>
    s === 'paid' ? 'bg-emerald-500/20 text-emerald-400' :
    s === 'sent' ? 'bg-blue-500/20 text-blue-400' :
    'bg-gray-500/20 text-gray-400'

  const filters: FilterType[] = ['all', 'draft', 'sent', 'paid']

  return (
    <div className="p-6 h-full overflow-auto">
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

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4 bg-surface-800 rounded-lg p-1 w-fit">
        {filters.map(f => (
          <button
            key={f}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              filter === f ? 'bg-brand-500 text-white' : 'text-gray-400 hover:text-white'
            }`}
            onClick={() => setFilter(f)}
          >
            {t(`invoices.filter_${f}`)} <span className="ml-1 opacity-60">({counts[f]})</span>
          </button>
        ))}
      </div>

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
              className="bg-surface-800 border border-surface-600 rounded-xl p-4 flex items-center gap-4 hover:border-surface-500 transition-colors cursor-pointer"
              onClick={() => openEdit(inv)}
            >
              <div className="w-1 self-stretch rounded-full bg-brand-500/40" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{inv.number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(inv.status)}`}>
                    {t(`invoices.status_${inv.status}`)}
                  </span>
                </div>
                <p className="text-gray-400 text-sm truncate mt-0.5">{inv.customer_name ?? '—'}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-sm">{formatCurrency(inv.total)}</p>
                <p className="text-gray-500 text-xs mt-0.5">{inv.issue_date ?? '—'}</p>
              </div>
              <div className="flex gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                <button
                  className="text-gray-500 hover:text-white p-1.5 rounded-lg hover:bg-surface-700 transition-colors"
                  onClick={() => handlePrint(inv)}
                  title={t('invoices.print')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                </button>
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
            <div className="flex items-center justify-between p-5 border-b border-surface-600">
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

            <div className="p-5 space-y-4">
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
                    <option value="sent">{t('invoices.status_sent')}</option>
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
                  <button className="text-xs text-brand-400 hover:text-brand-300" onClick={() => setItems(p => [...p, emptyLine()])}>
                    + {t('invoices.addItem')}
                  </button>
                </div>
                <div className="border border-surface-600 rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
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
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <label className="block text-xs text-gray-400 mb-1">{t('invoices.notes')}</label>
                  <textarea className="input w-full h-20 resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('invoices.notesPlaceholder')} />
                </div>
                <div className="w-64 space-y-2 text-sm">
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
            <div className="flex justify-between items-center p-5 border-t border-surface-600">
              <button className="text-gray-400 hover:text-white text-sm" onClick={closeModal}>{t('invoices.cancel')}</button>
              <div className="flex gap-3">
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
