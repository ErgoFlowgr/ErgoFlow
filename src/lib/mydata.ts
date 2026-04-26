/**
 * myDATA / ΑΑΔΕ invoice submission — shared logic for Electron and Android.
 *
 * XML building runs identically on both platforms.
 * HTTP call: Electron routes via IPC (no CORS), Android calls directly (native WebView bypasses CORS).
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
  mydataUserId: string
  mydataApiKey: string
}

export interface MydataResult {
  success: boolean
  mark?: string
  error?: string
}

// Switch to https://mydataapi.aade.gr/SendInvoices before going live
const MYDATA_URL = 'https://mydataapidev.aade.gr/SendInvoices'

export function buildMydataXml(params: MydataParams): string {
  const { invoice, lineItems, companyVat, customerVat } = params
  const isReceipt = invoice.document_type === 'receipt'
  const invoiceType = isReceipt ? '11.2' : '1.1'
  const clsCategory = isReceipt ? 'category1_3' : 'category1_1'
  const clsType     = isReceipt ? 'E3_561_007'  : 'E3_561_001'

  const seriesMatch = invoice.number.match(/^([A-Za-z]+)/)
  const aaMatch     = invoice.number.match(/(\d+)$/)
  const series = seriesMatch ? seriesMatch[1] : 'A'
  const aa     = aaMatch    ? String(parseInt(aaMatch[1], 10)) : '1'
  const issueDate = invoice.issue_date ?? new Date().toISOString().slice(0, 10)

  const afterDiscount = invoice.total - invoice.tax_amount
  const discountFactor = invoice.subtotal > 0 ? afterDiscount / invoice.subtotal : 1
  const taxRate = afterDiscount > 0 ? invoice.tax_amount / afterDiscount : 0
  let netAccum = 0
  let vatAccum = 0

  const detailLines = lineItems.map((item, idx) => {
    let netValue: number
    let vatAmount: number
    if (idx === lineItems.length - 1) {
      netValue = Math.round((afterDiscount - netAccum) * 100) / 100
      vatAmount = Math.round((invoice.tax_amount - vatAccum) * 100) / 100
    } else {
      netValue = Math.round(item.total * discountFactor * 100) / 100
      vatAmount = Math.round(netValue * taxRate * 100) / 100
      netAccum += netValue
      vatAccum += vatAmount
    }
    return `
    <invoiceDetails>
      <lineNumber>${idx + 1}</lineNumber>
      <netValue>${netValue.toFixed(2)}</netValue>
      <vatCategory>1</vatCategory>
      <vatAmount>${vatAmount.toFixed(2)}</vatAmount>
      <incomeClassification>
        <icls:classificationType>${clsType}</icls:classificationType>
        <icls:classificationCategory>${clsCategory}</icls:classificationCategory>
        <icls:amount>${netValue.toFixed(2)}</icls:amount>
      </incomeClassification>
    </invoiceDetails>`
  }).join('')

  const counterpartBlock = (!isReceipt && customerVat) ? `
    <counterpart>
      <vatNumber>${customerVat}</vatNumber>
      <country>GR</country>
      <branch>0</branch>
    </counterpart>` : ''

  return `<?xml version="1.0" encoding="UTF-8"?>
<InvoicesDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0"
             xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
             xmlns:icls="https://www.aade.gr/myDATA/incomeClassificaton/v1.0"
             xmlns:ecls="https://www.aade.gr/myDATA/expensesClassificaton/v1.0">
  <invoice>
    <issuer>
      <vatNumber>${companyVat}</vatNumber>
      <country>GR</country>
      <branch>0</branch>
    </issuer>${counterpartBlock}
    <invoiceHeader>
      <series>${series}</series>
      <aa>${aa}</aa>
      <issueDate>${issueDate}</issueDate>
      <invoiceType>${invoiceType}</invoiceType>
      <currency>EUR</currency>
    </invoiceHeader>
    <paymentMethods>
      <paymentMethodDetails>
        <type>3</type>
        <amount>${invoice.total.toFixed(2)}</amount>
      </paymentMethodDetails>
    </paymentMethods>${detailLines}
    <invoiceSummary>
      <totalNetValue>${afterDiscount.toFixed(2)}</totalNetValue>
      <totalVatAmount>${invoice.tax_amount.toFixed(2)}</totalVatAmount>
      <totalWithheldAmount>0.00</totalWithheldAmount>
      <totalFeesAmount>0.00</totalFeesAmount>
      <totalStampDutyAmount>0.00</totalStampDutyAmount>
      <totalOtherTaxesAmount>0.00</totalOtherTaxesAmount>
      <totalDeductionsAmount>0.00</totalDeductionsAmount>
      <totalGrossValue>${invoice.total.toFixed(2)}</totalGrossValue>
      <incomeClassification>
        <icls:classificationType>${clsType}</icls:classificationType>
        <icls:classificationCategory>${clsCategory}</icls:classificationCategory>
        <icls:amount>${afterDiscount.toFixed(2)}</icls:amount>
      </incomeClassification>
    </invoiceSummary>
  </invoice>
</InvoicesDoc>`
}

export async function submitToMydata(params: MydataParams): Promise<MydataResult> {
  const { mydataUserId, mydataApiKey } = params
  const xml = buildMydataXml(params)

  const isElectron = typeof window !== 'undefined' && !!window.electron
  let responseText: string
  let ok: boolean

  if (isElectron) {
    // Electron: route through IPC to bypass CORS via Electron's net module
    const result = await window.electron!.mydataSubmit({
      invoice: params.invoice,
      lineItems: params.lineItems,
      companyVat: params.companyVat,
      customerVat: params.customerVat,
      mydataUserId,
      mydataApiKey,
    })
    return result
  }

  // Android / mobile: direct fetch (native WebView is not subject to CORS)
  const res = await fetch(MYDATA_URL, {
    method: 'POST',
    headers: {
      'aade-user-id': mydataUserId,
      'Ocp-Apim-Subscription-Key': mydataApiKey,
      'Content-Type': 'application/xml',
    },
    body: xml,
  })
  responseText = await res.text()
  ok = res.ok

  if (!ok) return { success: false, error: `HTTP ${res.status}: ${responseText}` }

  const markMatch = responseText.match(/<invoiceMark>(\d+)<\/invoiceMark>/)
  const mark = markMatch ? markMatch[1] : null
  if (!mark) return { success: false, error: `No ΜΑΡΚ in response: ${responseText}` }

  return { success: true, mark }
}
