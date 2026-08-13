import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ipc, isElectron } from '../../lib/electron'
import { useTranslation } from 'react-i18next'
import {
  getOffers, getOfferItems, getNextOfferNumber, upsertOffer, deleteOffer,
  getCustomers, getSettings, getInventory, upsertJob, uuid,
  type Offer, type OfferItem, type Customer, type Settings, type InventoryItem,
} from '../../lib/db'
import { cancelOfferExpiryReminders, scheduleJobReminder, scheduleOfferExpiryReminders } from '../../lib/notifications'

type FilterType = 'all' | 'pending' | 'accepted' | 'rejected'

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

async function buildOfferHtml(off: Offer, items: OfferItem[], settings: Settings | null): Promise<string> {
  const company   = settings?.company_name ?? ''
  const ownerName = settings?.owner_name   ?? ''
  const ownerLast = settings?.owner_last_name ?? ''
  const fullName  = [ownerName, ownerLast].filter(Boolean).join(' ')
  const phone     = settings?.phone        ?? ''
  const phone2    = settings?.phone2       ?? ''
  const address   = settings?.address      ?? ''
  const workType  = settings?.work_type    ?? ''
  const bannerColor = '#3730a3'
  const totalsHeaderColor = '#3730a3'

  const rows = items.map(it => `
    <tr>
      <td class="td-desc">${it.description}</td>
      <td class="td-center">${it.quantity}</td>
      <td class="td-right">${it.unit_price.toFixed(2)} €</td>
      <td class="td-right">${it.total.toFixed(2)} €</td>
    </tr>`).join('')

  const html = `<!DOCTYPE html>
<html lang="el"><head><meta charset="UTF-8"><title>${off.number}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 13px; color: #222; background: #fff; padding: 30px 40px; }

  .banner { background: ${bannerColor}; color: #fff; padding: 18px 24px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 0; }
  .banner-company { font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
  .banner-type { font-size: 15px; font-weight: 600; text-align: right; }
  .banner-number { font-size: 12px; opacity: 0.8; margin-top: 2px; }

  .info-row { display: flex; border: 1px solid #ccc; border-top: none; margin-bottom: 20px; }
  .info-box { flex: 1; padding: 12px 16px; }
  .info-box + .info-box { border-left: 1px solid #ccc; }
  .info-box h3 { font-size: 10px; text-transform: uppercase; color: #888; letter-spacing: 0.8px; margin-bottom: 6px; border-bottom: 1px solid #eee; padding-bottom: 4px; }
  .info-box p { font-size: 13px; line-height: 1.6; }
  .info-box .name { font-weight: 700; font-size: 14px; }

  .dates-strip { display: flex; background: #eef0fb; border: 1px solid #c5c8e8; margin-bottom: 20px; }
  .date-cell { flex: 1; padding: 8px 16px; }
  .date-cell + .date-cell { border-left: 1px solid #c5c8e8; }
  .date-label { font-size: 10px; text-transform: uppercase; color: #3730a3; font-weight: 700; letter-spacing: 0.5px; }
  .date-value { font-size: 13px; font-weight: 600; margin-top: 2px; }

  table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  table.items thead tr { background: ${bannerColor}; color: #fff; }
  table.items th { padding: 9px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; }
  table.items th:first-child { text-align: left; }
  table.items th:not(:first-child) { text-align: right; }
  table.items tbody tr:nth-child(even) { background: #f7f7fc; }
  table.items td { padding: 9px 12px; border-bottom: 1px solid #e5e5f0; }
  .td-desc { text-align: left; }
  .td-center { text-align: right; }
  .td-right { text-align: right; }

  .bottom { display: flex; justify-content: flex-end; margin-bottom: 20px; }
  .totals-box { width: 260px; border: 1px solid #c5c8e8; }
  .totals-box .t-row { display: flex; justify-content: space-between; padding: 7px 14px; border-bottom: 1px solid #e5e5f0; font-size: 13px; }
  .totals-box .t-row:last-child { border-bottom: none; background: ${totalsHeaderColor}; color: #fff; font-weight: 700; font-size: 15px; }
  .totals-box .t-label { color: inherit; }
  .totals-box .t-value { font-weight: 600; }

  .notes-box { border: 1px solid #e0e0e0; padding: 10px 14px; font-size: 12px; color: #555; margin-bottom: 20px; background: #fafafa; }
  .notes-box strong { color: #333; }

  .footer { text-align: center; font-size: 11px; color: #999; border-top: 1px solid #eee; padding-top: 14px; }

  @media print { body { padding: 10px 20px; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
</style></head><body>

<div class="banner">
  <div style="display:flex;align-items:center;gap:14px">
    ${settings?.company_logo ? `<img src="${settings.company_logo}" style="max-height:60px;max-width:120px;object-fit:contain;flex-shrink:0" />` : ''}
    <div>
      <div class="banner-company">${company || 'Η Εταιρεία Σας'}</div>
      ${workType ? `<div style="font-size:12px;opacity:0.8;margin-top:3px">${workType}</div>` : ''}
    </div>
  </div>
  <div style="text-align:right">
    <div class="banner-type">ΠΡΟΣΦΟΡΑ / OFFER</div>
    <div class="banner-number">${off.number}</div>
  </div>
</div>

<div class="info-row">
  <div class="info-box">
    <h3>Πωλητής / From</h3>
    <p class="name">${company || '—'}</p>
    ${fullName ? `<p>${fullName}</p>` : ''}
    ${address ? `<p>${address}</p>` : ''}
    ${phone ? `<p>Κιν: ${phone}</p>` : ''}
    ${phone2 ? `<p>Σταθ: ${phone2}</p>` : ''}
  </div>
  <div class="info-box">
    <h3>Προς / To</h3>
    <p class="name">${off.customer_name ?? '—'}</p>
    ${off.customer_address ? `<p>${off.customer_address}</p>` : ''}
  </div>
</div>

<div class="dates-strip">
  <div class="date-cell">
    <div class="date-label">Αριθμός / Offer #</div>
    <div class="date-value">${off.number}</div>
  </div>
  <div class="date-cell">
    <div class="date-label">Ημερομηνία / Date</div>
    <div class="date-value">${off.issue_date ?? '—'}</div>
  </div>
  <div class="date-cell">
    <div class="date-label">Ισχύει έως / Valid Until</div>
    <div class="date-value">${off.expiry_date ?? '—'}</div>
  </div>
</div>

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

<div class="bottom">
  <div class="totals-box">
    <div class="t-row"><span class="t-label">Υποσύνολο / Subtotal</span><span class="t-value">${off.subtotal.toFixed(2)} €</span></div>
    ${off.discount_amount > 0 ? `<div class="t-row" style="color:#c0392b"><span class="t-label">Έκπτωση / Discount${off.discount_type === 'percent' ? ` (${off.discount_value}%)` : ''}</span><span class="t-value">-${off.discount_amount.toFixed(2)} €</span></div>` : ''}
    ${off.tax_rate > 0 ? `<div class="t-row"><span class="t-label">ΦΠΑ ${off.tax_rate}% / VAT</span><span class="t-value">${off.tax_amount.toFixed(2)} €</span></div>` : ''}
    <div class="t-row"><span class="t-label">ΣΥΝΟΛΟ / TOTAL</span><span class="t-value">${off.total.toFixed(2)} €</span></div>
  </div>
</div>

${off.notes ? `<div class="notes-box"><strong>Σημειώσεις / Notes:</strong> ${off.notes}</div>` : ''}

<div class="footer">Η προσφορά ισχύει για 30 ημέρες &bull; This offer is valid for 30 days</div>

</body></html>`
  return html
}

async function printOffer(off: Offer, items: OfferItem[], settings: Settings | null) {
  const html = await buildOfferHtml(off, items, settings)
  if (isElectron) {
    await ipc.printInvoice(html)
  } else {
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close(); win.print() }
  }
}

async function saveOfferPdf(off: Offer, items: OfferItem[], settings: Settings | null) {
  const html = await buildOfferHtml(off, items, settings)
  const name = `Προσφορά-${off.number}`
  if (isElectron) {
    await ipc.savePdf(html, name)
  } else {
    const { Share } = await import('@capacitor/share')
    await Share.share({ title: name, text: html, dialogTitle: 'Κοινοποίηση προσφοράς' })
  }
}

export default function Offers() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const [offers, setOffers] = useState<Offer[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [filter, setFilter] = useState<FilterType>('all')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Offer | null>(null)
  const [items, setItems] = useState<LineItem[]>([emptyLine()])
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<InventoryItem[]>([])
  const [showCatalog, setShowCatalog] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [creatingJob, setCreatingJob] = useState<string | null>(null)
  const [confirmJobOffer, setConfirmJobOffer] = useState<Offer | null>(null)
  const [confirmJobDate, setConfirmJobDate] = useState('')
  const [printPreviewHtml, setPrintPreviewHtml] = useState<string | null>(null)

  // Form state
  const [number, setNumber] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [showCustomerList, setShowCustomerList] = useState(false)
  const [customerAddress, setCustomerAddress] = useState('')
  const [status, setStatus] = useState<Offer['status']>('pending')
  const [issueDate, setIssueDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [taxRate, setTaxRate] = useState(24)
  const [discountType, setDiscountType] = useState<'percent' | 'flat' | null>(null)
  const [discountValue, setDiscountValue] = useState(0)
  const [notes, setNotes] = useState('')

  const load = async () => {
    let loadedOffers: Offer[] = []
    try { loadedOffers = await getOffers(); setOffers(loadedOffers) } catch { /* table may not exist yet */ }
    setCustomers(await getCustomers())
    setSettings(await getSettings())
    try { setCatalog(await getInventory()) } catch { /* ignore */ }
    // Auto-open a specific offer if navigated here with an offerId in state
    const offerId = (location.state as { offerId?: string } | null)?.offerId
    if (offerId) {
      const target = loadedOffers.find(o => o.id === offerId)
      if (target) openEdit(target)
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const filtered = filter === 'all' ? offers : offers.filter(o => o.status === filter)
  const counts = {
    all: offers.length,
    pending: offers.filter(o => o.status === 'pending').length,
    accepted: offers.filter(o => o.status === 'accepted').length,
    rejected: offers.filter(o => o.status === 'rejected').length,
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
    try { num = await getNextOfferNumber() } catch { num = `${new Date().getFullYear()}-001` }
    setEditing(null)
    setNumber(num)
    setCustomerId('')
    setCustomerName('')
    setCustomerAddress('')
    setStatus('pending')
    setIssueDate(new Date().toISOString().slice(0, 10))
    setExpiryDate('')
    setTaxRate(24)
    setDiscountType(null)
    setDiscountValue(0)
    setNotes('')
    setItems([emptyLine()])
    setShowModal(true)
  }

  const openEdit = async (off: Offer) => {
    const existingItems = await getOfferItems(off.id)
    setEditing(off)
    setNumber(off.number)
    setCustomerId(off.customer_id ?? '')
    setCustomerName(off.customer_name ?? '')
    setCustomerAddress(off.customer_address ?? '')
    setStatus(off.status)
    setIssueDate(off.issue_date ?? '')
    setExpiryDate(off.expiry_date ?? '')
    setTaxRate(off.tax_rate)
    setDiscountType(off.discount_type ?? null)
    setDiscountValue(off.discount_value ?? 0)
    setNotes(off.notes ?? '')
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
      const offData: Partial<Offer> & { number: string } = {
        id: editing?.id,
        number: number.trim(),
        customer_id: customerId || null,
        customer_name: customerName.trim() || null,
        customer_address: customerAddress || null,
        status,
        issue_date: issueDate || null,
        expiry_date: expiryDate || null,
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
      const offerId = await upsertOffer(offData, lineItems)
      await scheduleOfferExpiryReminders({
        id: offerId,
        title: number.trim(),
        customerName: customerName.trim() || null,
        expiryDate: expiryDate || null,
        status,
      })
      await load()
      closeModal()
    } catch (e) {
      alert('Σφάλμα αποθήκευσης: ' + String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await cancelOfferExpiryReminders(id)
    await deleteOffer(id)
    setDeleteConfirm(null)
    await load()
  }

  const handlePrint = async (off: Offer) => {
    try {
      const offItems = await getOfferItems(off.id)
      if (isElectron) {
        await printOffer(off, offItems, settings)
      } else {
        const html = await buildOfferHtml(off, offItems, settings)
        setPrintPreviewHtml(html)
      }
    } catch (e) {
      alert('Print error: ' + e)
    }
  }

  const handleSavePdf = async (off: Offer) => {
    try {
      const offItems = await getOfferItems(off.id)
      await saveOfferPdf(off, offItems, settings)
    } catch (e) {
      alert('PDF error: ' + e)
    }
  }

  const handleShareMessenger = async (off: Offer, messenger: 'whatsapp' | 'viber') => {
    const offItems = await getOfferItems(off.id)
    const lines = offItems.filter(it => it.description.trim()).map(it =>
      `  • ${it.description} x${it.quantity}  ${it.total.toLocaleString('el-GR', { minimumFractionDigits: 2 })}€`
    ).join('\n')
    const discount = off.discount_amount > 0
      ? `\nΈκπτωση: -${off.discount_amount.toLocaleString('el-GR', { minimumFractionDigits: 2 })}€`
      : ''
    const companyName = settings?.company_name ?? ''
    const phone = settings?.phone ?? settings?.phone2 ?? ''
    const text = [
      `📋 ΠΡΟΣΦΟΡΑ ${off.number}`,
      `Ημερομηνία: ${off.issue_date ?? ''}`,
      off.customer_name ? `Πελάτης: ${off.customer_name}` : '',
      '',
      'Εργασίες / Υλικά:',
      lines,
      '',
      `Καθαρή αξία: ${off.subtotal.toLocaleString('el-GR', { minimumFractionDigits: 2 })}€${discount}`,
      `ΦΠΑ 24%: ${off.tax_amount.toLocaleString('el-GR', { minimumFractionDigits: 2 })}€`,
      `ΣΥΝΟΛΟ: ${off.total.toLocaleString('el-GR', { minimumFractionDigits: 2 })}€`,
      off.notes ? `\nΣημειώσεις: ${off.notes}` : '',
      '',
      [companyName, phone].filter(Boolean).join(' | '),
    ].filter(l => l !== undefined && l !== null).join('\n').trim()

    const encoded = encodeURIComponent(text)
    const url = messenger === 'whatsapp'
      ? `whatsapp://send?text=${encoded}`
      : `viber://forward?text=${encoded}`
    if (isElectron) await ipc.openExternal(url)
    else window.open(url, '_blank')
  }

  const handleShareEmail = async (off: Offer) => {
    const customer = customers.find(c => c.id === off.customer_id)
    const email = customer?.email?.trim()
    if (!email) {
      alert('Δεν υπάρχει email στον πελάτη.')
      return
    }

    const offItems = await getOfferItems(off.id)
    const lines = offItems.filter(it => it.description.trim()).map(it =>
      `  • ${it.description} x${it.quantity}  ${it.total.toLocaleString('el-GR', { minimumFractionDigits: 2 })}€`
    ).join('\n')
    const companyName = settings?.company_name ?? ''
    const phone = settings?.phone ?? settings?.phone2 ?? ''
    const subject = `Προσφορά ${off.number}${off.customer_name ? ' - ' + off.customer_name : ''}`
    const body = [
      `Καλησπέρα${off.customer_name ? ' ' + off.customer_name : ''},`,
      '',
      `Σας στέλνουμε την προσφορά ${off.number}.`,
      off.issue_date ? `Ημερομηνία: ${off.issue_date}` : '',
      off.expiry_date ? `Ισχύει έως: ${off.expiry_date}` : '',
      '',
      lines ? `Εργασίες / Υλικά:\n${lines}` : '',
      '',
      `Σύνολο: ${off.total.toLocaleString('el-GR', { minimumFractionDigits: 2 })}€`,
      off.notes ? `\nΣημειώσεις: ${off.notes}` : '',
      '',
      [companyName, phone].filter(Boolean).join(' | '),
    ].filter(Boolean).join('\n')
    const url = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    if (isElectron) await ipc.openExternal(url)
    else window.location.href = url
  }

  const handleCreateJob = async (off: Offer, scheduledDate?: string) => {
    setCreatingJob(off.id)
    try {
      const offItems = await getOfferItems(off.id)
      const description = offItems
        .filter(it => it.description.trim())
        .map(it => `${it.description} x${it.quantity}`)
        .join('\n')
      const jobId = await upsertJob({
        customer_id: off.customer_id ?? undefined,
        customer_name: off.customer_name ?? undefined,
        title: `${off.number}${off.customer_name ? ' — ' + off.customer_name : ''}`,
        description: description || null,
        status: 'pending',
        priority: 'normal',
        scheduled_date: scheduledDate || null,
        offer_id: off.id,
      })
      await scheduleJobReminder({
        id: jobId,
        title: `${off.number}${off.customer_name ? ' — ' + off.customer_name : ''}`,
        customerName: off.customer_name,
        scheduledDate: scheduledDate || null,
        status: 'pending',
      })
      navigate('/jobs')
    } finally {
      setCreatingJob(null)
    }
  }

  const statusColor = (s: Offer['status']) =>
    s === 'accepted' ? 'bg-emerald-500/20 text-emerald-400' :
    s === 'rejected' ? 'bg-red-500/20 text-red-400' :
    'bg-yellow-500/20 text-yellow-400'

  const filters: FilterType[] = ['all', 'pending', 'accepted', 'rejected']

  return (
    <div className="px-3 py-4 sm:p-6 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('offers.title')}</h1>
          <p className="text-gray-400 text-sm mt-0.5">{offers.length} {t('offers.subtitle')}</p>
        </div>
        <button className="btn-primary" onClick={openNew}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('offers.newOffer')}
        </button>
      </div>

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
            {t(`offers.filter_${f}`)} <span className="ml-1 opacity-60">({counts[f]})</span>
          </button>
        ))}
      </div>

      {/* Offer list */}
      {filtered.length === 0 ? (
        <div className="text-center py-20">
          <svg className="w-12 h-12 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          <p className="text-gray-500">{t('offers.noOffers')}</p>
          <p className="text-gray-600 text-sm mt-1">{t('offers.noOffersSub')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(off => (
            <div
              key={off.id}
              className="bg-surface-800 border border-surface-600 rounded-xl p-4 flex flex-wrap items-center gap-4 hover:border-surface-500 transition-colors cursor-pointer"
              onClick={() => openEdit(off)}
            >
              <div className="w-1 self-stretch rounded-full bg-indigo-500/40" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{off.number}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(off.status)}`}>
                    {t(`offers.status_${off.status}`)}
                  </span>
                </div>
                <p className="text-gray-400 text-sm truncate mt-0.5">{off.customer_name ?? '—'}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="font-bold text-sm">{formatCurrency(off.total)}</p>
                <p className="text-gray-500 text-xs mt-0.5">{off.issue_date ?? '—'}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 shrink-0 items-center" onClick={e => e.stopPropagation()}>
                <button
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                  onClick={() => navigate('/invoices', { state: { fromOffer: { customer_id: off.customer_id, customer_name: off.customer_name, customer_address: off.customer_address, offer_number: off.number, offer_id: off.id } } })}
                  title={t('offers.createInvoiceBtn')}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </button>
                <button
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-surface-700 text-gray-300 hover:bg-brand-500/20 hover:text-brand-400 transition-colors"
                  onClick={() => { setConfirmJobDate(''); setConfirmJobOffer(off) }}
                  disabled={creatingJob === off.id}
                  title={t('offers.createJob')}
                >
                  {creatingJob === off.id ? (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  ) : (
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                  )}
                </button>
                <button
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-green-500/10 text-green-400 hover:bg-green-500/20 transition-colors"
                  onClick={() => handleShareMessenger(off, 'whatsapp')}
                  title="Κοινοποίηση στο WhatsApp"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                    <path d="M11.992 2C6.476 2 2 6.476 2 11.992c0 1.814.487 3.516 1.338 4.983L2 22l5.166-1.315A9.96 9.96 0 0011.992 22c5.516 0 9.992-4.476 9.992-9.992C21.984 6.476 17.508 2 11.992 2zm0 18.316a8.292 8.292 0 01-4.221-1.153l-.303-.18-3.067.781.813-2.981-.198-.314A8.324 8.324 0 013.684 11.992c0-4.585 3.731-8.316 8.308-8.316 4.585 0 8.316 3.731 8.316 8.316 0 4.577-3.731 8.324-8.316 8.324z"/>
                  </svg>
                  WA
                </button>
                <button
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 transition-colors"
                  onClick={() => handleShareMessenger(off, 'viber')}
                  title="Κοινοποίηση στο Viber"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M11.992 2C6.476 2 2 6.476 2 11.992c0 2.172.693 4.18 1.864 5.822L2.5 21.5l3.794-1.328A9.956 9.956 0 0011.992 22c5.516 0 9.992-4.476 9.992-9.992C21.984 6.476 17.508 2 11.992 2zm4.9 13.9c-.21.588-.942 1.176-1.596 1.26-.42.042-.966.084-3.108-.672-2.604-.966-4.284-3.612-4.41-3.78-.126-.168-1.05-1.386-1.05-2.646 0-1.26.672-1.89 1.008-2.142.336-.252.714-.336.966-.336.252 0 .462 0 .672.042.21.042.504-.084.798.588.294.672 1.008 2.31 1.092 2.478.084.168.126.378 0 .588-.126.21-.168.336-.336.504-.168.168-.336.378-.462.504-.168.168-.336.378-.168.714.168.336.756 1.26 1.638 2.058 1.134 1.008 2.1 1.344 2.394 1.47.294.126.462.084.63-.084.168-.168.714-.84.882-1.134.168-.294.378-.252.63-.168.252.084 1.638.798 1.932.966.294.168.504.252.588.378.084.168.084.672-.126 1.26z"/>
                  </svg>
                  Viber
                </button>
                <button
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors"
                  onClick={() => handleShareEmail(off)}
                  title="Αποστολή με email"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Email
                </button>
                <button
                  className="text-gray-500 hover:text-white p-1.5 rounded-lg hover:bg-surface-700 transition-colors"
                  onClick={() => handlePrint(off)}
                  title={t('offers.print')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                </button>
                <button
                  className="text-gray-500 hover:text-red-300 p-1.5 rounded-lg hover:bg-surface-700 transition-colors"
                  onClick={() => handleSavePdf(off)}
                  title={t('offers.savePdf')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                  </svg>
                </button>
                <button
                  className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-surface-700 transition-colors"
                  onClick={() => setDeleteConfirm(off.id)}
                  title={t('offers.delete')}
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
              <h2 className="text-lg font-bold">{editing ? editing.number : t('offers.newOffer')}</h2>
              <button className="text-gray-400 hover:text-white" onClick={closeModal}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 sm:p-5 space-y-4">
              {/* Row 1: number + status */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('offers.number')}</label>
                  <input className="input w-full" value={number} onChange={e => setNumber(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('offers.status')}</label>
                  <select className="input w-full" value={status} onChange={e => setStatus(e.target.value as Offer['status'])}>
                    <option value="pending">{t('offers.status_pending')}</option>
                    <option value="accepted">{t('offers.status_accepted')}</option>
                    <option value="rejected">{t('offers.status_rejected')}</option>
                  </select>
                </div>
              </div>

              {/* Customer combobox */}
              <div className="grid grid-cols-2 gap-4">
                <div className="relative">
                  <label className="block text-xs text-gray-400 mb-1">{t('offers.customer')}</label>
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
                    placeholder={t('offers.noCustomer')}
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
                  <label className="block text-xs text-gray-400 mb-1">{t('offers.customerAddress')}</label>
                  <input className="input w-full" value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder={t('offers.addressPlaceholder')} />
                </div>
              </div>

              {/* Dates */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('offers.issueDate')}</label>
                  <input type="date" className="input w-full" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('offers.expiryDate')}</label>
                  <input type="date" className="input w-full" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} />
                </div>
              </div>

              {/* Line items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-gray-400 uppercase tracking-wider">{t('offers.items')}</label>
                  <div className="flex gap-3">
                    <button className="text-xs text-brand-400 hover:text-brand-300" onClick={() => setItems(p => [...p, emptyLine()])}>
                      + {t('offers.addItem')}
                    </button>
                    {catalog.length > 0 && (
                      <button className="text-xs text-indigo-400 hover:text-indigo-300" onClick={() => { setCatalogSearch(''); setShowCatalog(true) }}>
                        📦 {i18n.language === 'en' ? 'From catalog' : 'Από κατάλογο'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="border border-surface-600 rounded-lg overflow-x-auto">
                  <table className="w-full min-w-[320px] text-sm">
                    <thead className="bg-surface-700">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs text-gray-400 font-medium">{t('offers.description')}</th>
                        <th className="text-right px-2 py-2 text-xs text-gray-400 font-medium w-14">{t('offers.qty')}</th>
                        <th className="text-right px-2 py-2 text-xs text-gray-400 font-medium w-20">{t('offers.unitPrice')}</th>
                        <th className="hidden sm:table-cell text-right px-3 py-2 text-xs text-gray-400 font-medium w-24">{t('offers.lineTotal')}</th>
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
                              placeholder={t('offers.descriptionPlaceholder')}
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="text" inputMode="decimal"
                              className="bg-transparent w-full outline-none text-sm text-right px-1"
                              value={it.quantity || ''}
                              onFocus={e => { if (e.target.value === '0') e.target.value = '' }}
                              onBlur={e => { if (!e.target.value) updateItem(idx, 'quantity', 0) }}
                              onChange={e => updateItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="px-1 py-1">
                            <input
                              type="text" inputMode="decimal"
                              className="bg-transparent w-full outline-none text-sm text-right px-1"
                              value={it.unit_price || ''}
                              onFocus={e => { if (e.target.value === '0') e.target.value = '' }}
                              onBlur={e => { if (!e.target.value) updateItem(idx, 'unit_price', 0) }}
                              onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                            />
                          </td>
                          <td className="hidden sm:table-cell px-3 py-1 text-right text-sm whitespace-nowrap">{it.total.toFixed(2)} €</td>
                          <td className="px-2 py-1 text-center">
                            <button
                              className={`p-1 rounded transition-colors ${items.length > 1 ? 'text-gray-500 hover:text-red-400' : 'text-gray-700 cursor-default'}`}
                              onClick={() => { if (items.length > 1) setItems(p => p.filter((_, i) => i !== idx)) }}
                              title={t('offers.removeItem') ?? 'Αφαίρεση γραμμής'}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
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
                  <label className="block text-xs text-gray-400 mb-1">{t('offers.notes')}</label>
                  <textarea className="input w-full h-20 resize-none" value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('offers.notesPlaceholder')} />
                </div>
                <div className="w-full sm:w-64 space-y-2 text-sm">
                  <div className="flex justify-between text-gray-400">
                    <span>{t('offers.subtotal')}</span>
                    <span>{subtotal.toFixed(2)} €</span>
                  </div>
                  {/* Discount */}
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-gray-400">{t('offers.discount')}</span>
                    <div className="flex items-center gap-1">
                      <select
                        className="input py-1 text-xs"
                        value={discountType ?? ''}
                        onChange={e => setDiscountType((e.target.value as 'percent' | 'flat') || null)}
                      >
                        <option value="">{t('offers.discountNone')}</option>
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
                      <span>{t('offers.discount')} ({discountType === 'percent' ? `${discountValue}%` : `€${discountValue}`})</span>
                      <span>-{discountAmount.toFixed(2)} €</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-gray-400">{t('offers.tax')}</span>
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
                      <span>{t('offers.taxAmount')}</span>
                      <span>{taxAmount.toFixed(2)} €</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold border-t border-surface-600 pt-2">
                    <span>{t('offers.total')}</span>
                    <span>{total.toFixed(2)} €</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-wrap justify-between items-center gap-3 p-4 sm:p-5 border-t border-surface-600">
              <button className="text-gray-400 hover:text-white text-sm" onClick={closeModal}>{t('offers.cancel')}</button>
              <div className="flex flex-wrap gap-2 sm:gap-3">
                {editing && (
                  <>
                    <button
                      className="btn-secondary flex items-center gap-2 text-sm"
                      onClick={() => handlePrint(editing)}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                      {t('offers.print')}
                    </button>
                    <button
                      className="btn-secondary flex items-center gap-2 text-sm"
                      onClick={() => handleSavePdf(editing)}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h4a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                      </svg>
                      {t('offers.savePdf')}
                    </button>
                  </>
                )}
                <button className="btn-primary" onClick={handleSave} disabled={saving || !number.trim()}>
                  {saving ? t('offers.saving') : t('offers.save')}
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
              <h3 className="font-semibold">{i18n.language === 'en' ? 'Select from catalog' : 'Επιλογή από κατάλογο'}</h3>
              <button className="text-gray-400 hover:text-white" onClick={() => setShowCatalog(false)}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-3 border-b border-surface-600">
              <input
                className="input w-full text-sm"
                placeholder="Αναζήτηση..."
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

      {/* Confirm create job from non-accepted offer */}
      {confirmJobOffer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              </div>
              <div>
                <h3 className="font-bold text-base">{t('offers.createJob')}</h3>
                <p className="text-gray-400 text-xs mt-0.5">
                  {t('offers.createJobWarning', {
                    status: t(`offers.status_${confirmJobOffer.status}`),
                    number: confirmJobOffer.number,
                  })}
                </p>
              </div>
            </div>
            <label className="block text-xs text-gray-400 mb-1.5">{t('offers.scheduledDate')}</label>
            <input
              type="date"
              value={confirmJobDate}
              onChange={e => setConfirmJobDate(e.target.value)}
              className="input w-full mb-5"
            />
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setConfirmJobOffer(null)}>{t('offers.cancel')}</button>
              <button
                className="flex-1 bg-brand-500 hover:bg-brand-600 text-white rounded-lg py-2 font-medium text-sm transition-colors"
                onClick={() => { handleCreateJob(confirmJobOffer, confirmJobDate); setConfirmJobOffer(null) }}
              >
                {t('offers.createJobConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print preview overlay (mobile only) */}
      {printPreviewHtml && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-white">
          <div className="flex items-center gap-3 px-4 py-3 bg-gray-100 border-b border-gray-200 shrink-0">
            <button
              className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 bg-white border border-gray-300 rounded-lg px-3 py-1.5 shadow-sm"
              onClick={() => setPrintPreviewHtml(null)}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Πίσω
            </button>
            <span className="text-sm font-semibold text-gray-700 flex-1 truncate">Προεπισκόπηση προσφοράς</span>
            <button
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg px-3 py-1.5 shadow-sm"
              onClick={() => window.print()}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              Εκτύπωση
            </button>
          </div>
          <iframe
            className="flex-1 w-full border-none"
            srcDoc={printPreviewHtml}
            title="Προεπισκόπηση προσφοράς"
          />
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-bold mb-2">{t('offers.deleteConfirm')}</h3>
            <p className="text-gray-400 text-sm mb-5">{t('offers.deleteWarning')}</p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setDeleteConfirm(null)}>{t('offers.cancel')}</button>
              <button className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-lg py-2 font-medium text-sm transition-colors" onClick={() => handleDelete(deleteConfirm)}>
                {t('offers.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
