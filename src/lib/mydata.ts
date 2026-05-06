/**
 * e-invoicing submission — Bratnet API for Android, Electron IPC for desktop.
 *
 * Android path: two-step Bratnet flow (createSimSign → sendSimInvoice).
 *   fetch() calls go through the native layer via CapacitorHttp (enabled globally
 *   in capacitor.config.ts), so CORS is not an issue.
 * Electron path: delegated to IPC handler which reads credentials from DB itself.
 */

export interface MydataInvoice {
  number: string
  issue_date: string | null
  document_type: string
  subtotal: number
  tax_amount: number
  total: number
}

export interface MydataLineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
}

export interface MydataParams {
  invoice: MydataInvoice
  lineItems: MydataLineItem[]
  companyVat: string
  customerVat: string
  mydataUserId: string  // kept for Electron IPC compat; unused on Android
  mydataApiKey: string  // kept for Electron IPC compat; unused on Android
  bratnetUsername?: string
  bratnetApiKey?: string
}

export interface MydataResult {
  success: boolean
  mark?: string
  error?: string
}

// Switch to https://einvoicing-api.etimologiera.gr/v4 before going live
const BRATNET_BASE_URL = 'https://einvoicing-dev-api.etimologiera.gr/v4'

/** Parse series + aa from an invoice number like "ΑΠΥ-2026-001" or "INV-2026-003" */
function parseInvoiceNumber(number: string): { series: string; aa: number } {
  // Try to extract a leading Unicode/ASCII word as the series
  const seriesMatch = number.match(/^([\p{L}A-Za-z]+)/u)
  const aaMatch     = number.match(/(\d+)$/)
  const series = seriesMatch ? seriesMatch[1] : 'ΑΠΥ'
  const aa     = aaMatch    ? parseInt(aaMatch[1], 10) : 1
  return { series, aa }
}

/** Round to 2 decimal places */
function r2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function submitToMydata(params: MydataParams): Promise<MydataResult> {
  const isElectron = typeof window !== 'undefined' && !!window.electron

  if (isElectron) {
    // Electron: delegate entirely to IPC — the main process reads credentials from DB
    const result = await window.electron!.mydataSubmit({
      invoice:    params.invoice,
      lineItems:  params.lineItems,
      companyVat: params.companyVat,
      customerVat: params.customerVat,
      mydataUserId: params.mydataUserId,
      mydataApiKey: params.mydataApiKey,
    })
    return result
  }

  // ── Android: Bratnet two-step flow ────────────────────────────────────────

  const { bratnetUsername, bratnetApiKey } = params
  if (!bratnetUsername || !bratnetApiKey) {
    return { success: false, error: 'Missing Bratnet credentials. Go to Settings → myDATA / Bratnet.' }
  }

  const { invoice, lineItems, companyVat, customerVat } = params

  const issueDate = invoice.issue_date ?? new Date().toISOString().slice(0, 10)
  // issueTime: use current time; Bratnet requires HH:MM:SS
  const issueTime = new Date().toTimeString().slice(0, 8)

  const externalId = invoice.number  // stable unique ID; invoice number is unique per submission
  const { series, aa } = parseInvoiceNumber(invoice.number)

  // Derive net / vat totals (same discount-aware logic the XML builder used)
  const netValue  = r2(invoice.total - invoice.tax_amount)
  const vatAmount = r2(invoice.tax_amount)
  const total     = r2(invoice.total)

  const authHeader = 'Basic ' + btoa(bratnetUsername + ':' + bratnetApiKey)

  // ── Step 1: createSimSign ────────────────────────────────────────────────
  let signature: string
  try {
    const signRes = await fetch(`${BRATNET_BASE_URL}/createSimSign`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        externalSystemId: externalId,
        issuerVatNumber:  companyVat,
        invoiceIssueDate: issueDate,
        invoiceIssueTime: issueTime,
        invoiceType:      '1.1',
        invoiceSeries:    series,
        netValue,
        vatAmount,
        totalValue:       total,
        paymentAmount:    total,
        nspCode:          '01',
        terminalId:       'EF-001',
      }),
    })

    if (!signRes.ok) {
      const body = await signRes.text()
      return { success: false, error: `Bratnet createSimSign HTTP ${signRes.status}: ${body}` }
    }

    const signJson = await signRes.json() as { hSignature?: string }
    signature = signJson.hSignature ?? ''
    if (!signature) {
      return { success: false, error: `Bratnet createSimSign: no hSignature in response: ${JSON.stringify(signJson)}` }
    }
  } catch (err) {
    return { success: false, error: `Bratnet createSimSign network error: ${err instanceof Error ? err.message : String(err)}` }
  }

  // ── Step 2: sendSimInvoice ───────────────────────────────────────────────

  // Build per-line details distributing net/vat proportionally
  const discountFactor = invoice.subtotal > 0 ? netValue / invoice.subtotal : 1
  const taxRate        = netValue > 0 ? vatAmount / netValue : 0
  const vatRatePercent = Math.round(taxRate * 100)
  // Map tax rate % to vatCategory: 24→1, 13→2, 6→3, 0→4
  const vatCategory    = vatRatePercent >= 24 ? 1 : vatRatePercent >= 13 ? 2 : vatRatePercent >= 6 ? 3 : 4
  let netAccum = 0
  let vatAccum = 0

  const invoiceDetails = lineItems.map((item, idx) => {
    let lineNet: number
    let lineVat: number
    if (idx === lineItems.length - 1) {
      lineNet = r2(netValue - netAccum)
      lineVat = r2(vatAmount - vatAccum)
    } else {
      lineNet = r2(item.total * discountFactor)
      lineVat = r2(lineNet * taxRate)
      netAccum += lineNet
      vatAccum += lineVat
    }
    return {
      lineNumber:          idx + 1,
      code:                'SRV',
      name:                item.description || 'Υπηρεσία',
      quantity:            item.quantity,
      price:               r2(item.unit_price * discountFactor),
      netValue:            lineNet,
      vatCategory,
      vatPercent:          vatRatePercent,
      vatAmount:           lineVat,
      measurementUnitName: 'ΤΕΜ',
    }
  })

  // Use generic VAT for receipts or when customer VAT is absent
  const counterpartVat = customerVat?.trim() || '000000000'

  const sendBody = {
    invoice: [
      {
        issuer: {
          vatNumber: companyVat,
          country:   'GR',
          branch:    0,
        },
        counterpart: {
          vatNumber: counterpartVat,
          country:   'GR',
          branch:    0,
          address:   { postalCode: '00000', city: '' },
        },
        invoiceHeader: {
          series,
          aa,
          externalSystemId: externalId,
          issueDate,
          issueTime,
          invoiceType: '1.1',
          currency:    'EUR',
        },
        paymentMethods: [{ type: 3, amount: total }],
        invoiceDetails,
        invoiceSummary: {
          totalNetValue:   netValue,
          totalVatAmount:  vatAmount,
          totalGrossValue: total,
        },
        invoiceVatAnalysis: [{
          vatRate:   vatRatePercent,
          netValue,
          vatAmount,
        }],
        extra: {
          signature:     signature,
          transactionId: externalId,
          tipAmount:     0,
          nspCode:       '01',
        },
      },
    ],
  }

  try {
    const sendRes = await fetch(`${BRATNET_BASE_URL}/sendSimInvoice`, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(sendBody),
    })

    const sendJson = await sendRes.json() as { responses?: Array<{ invoiceMark?: string | number }> }

    if (!sendRes.ok) {
      return { success: false, error: `Bratnet sendSimInvoice HTTP ${sendRes.status}: ${JSON.stringify(sendJson)}` }
    }

    const mark = sendJson.responses?.[0]?.invoiceMark != null
      ? String(sendJson.responses[0].invoiceMark)
      : undefined

    if (!mark) {
      return { success: false, error: `Bratnet sendSimInvoice: no MARK in response: ${JSON.stringify(sendJson)}` }
    }

    return { success: true, mark }
  } catch (err) {
    return { success: false, error: `Bratnet sendSimInvoice network error: ${err instanceof Error ? err.message : String(err)}` }
  }
}
