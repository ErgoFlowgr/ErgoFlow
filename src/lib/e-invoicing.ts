export type EInvoicingEnvironment = 'sandbox' | 'production'
export type EInvoicingDocumentType = 'invoice' | 'receipt' | 'b2g' | 'retry'

export interface ProviderInvoice {
  number: string
  issue_date: string | null
  document_type: string
  subtotal: number
  tax_amount: number
  total: number
}

export interface ProviderLineItem {
  description: string
  quantity: number
  unit_price: number
  total: number
}

export interface IssueDocumentInput {
  invoice: ProviderInvoice
  lineItems: ProviderLineItem[]
  companyVat: string
  customerVat: string
}

export interface IssueDocumentResult {
  success: boolean
  provider: 'bratnet'
  mark?: string
  providerDocumentId?: string
  creditsUsed?: number
  error?: string
  raw?: unknown
}

export interface CreditBalanceResult {
  provider: 'bratnet'
  remainingCredits: number | null
  lowCredit: boolean
  checkedAt: string
  error?: string
}

export interface InvoiceProvider {
  issueDocument(input: IssueDocumentInput): Promise<IssueDocumentResult>
  getCredits(): Promise<CreditBalanceResult>
}

export interface BratnetCredentials {
  username: string
  apiKey: string
}

export interface BratnetProviderOptions {
  credentials: BratnetCredentials
  environment?: EInvoicingEnvironment
  baseUrl?: string
  fetchFn?: typeof fetch
  now?: () => Date
  lowCreditThreshold?: number
}

export const BRATNET_ENDPOINTS: Record<EInvoicingEnvironment, string> = {
  sandbox: 'https://einvoicing-dev-api.etimologiera.gr/v4',
  production: 'https://einvoicing-api.etimologiera.gr/v4',
}

const DEFAULT_TERMINAL_ID = 'EF-001'
const DEFAULT_NSP_CODE = '01'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function encodeBase64(value: string): string {
  if (typeof btoa === 'function') return btoa(value)
  const maybeBuffer = (globalThis as { Buffer?: { from: (value: string) => { toString: (encoding: string) => string } } }).Buffer
  if (maybeBuffer) return maybeBuffer.from(value).toString('base64')
  throw new Error('No base64 encoder available')
}

export function buildBasicAuthHeader(username: string, apiKey: string): string {
  return `Basic ${encodeBase64(`${username}:${apiKey}`)}`
}

export function parseDocumentNumber(number: string): { series: string; aa: number } {
  const seriesMatch = number.match(/^([\p{L}A-Za-z]+)/u)
  const aaMatch = number.match(/(\d+)$/)
  return {
    series: seriesMatch ? seriesMatch[1] : 'ΑΠΥ',
    aa: aaMatch ? parseInt(aaMatch[1], 10) : 1,
  }
}

export function estimateBratnetCreditCost(documentType: EInvoicingDocumentType | string): number {
  if (documentType === 'b2g') return 4
  if (documentType === 'invoice') return 2
  return 1
}

function inferInvoiceType(documentType: string): string {
  // Current ErgoFlow documents are service invoices/receipts. Keep this isolated so
  // future B2G/credit-note mappings are changed in one place, not all over the app.
  if (documentType === 'receipt') return '11.2'
  return '1.1'
}

function vatCategoryFromRate(vatRatePercent: number): number {
  if (vatRatePercent >= 24) return 1
  if (vatRatePercent >= 13) return 2
  if (vatRatePercent >= 6) return 3
  return 4
}

export interface BuildBratnetIssuePayloadInput extends IssueDocumentInput {
  issueTime: string
  signature: string
  environment?: EInvoicingEnvironment
}

export function buildBratnetIssuePayloads(input: BuildBratnetIssuePayloadInput) {
  const { invoice, lineItems, companyVat, customerVat, issueTime, signature } = input
  const environment = input.environment ?? 'sandbox'
  const issueDate = invoice.issue_date ?? new Date().toISOString().slice(0, 10)
  const externalSystemId = invoice.number
  const { series, aa } = parseDocumentNumber(invoice.number)
  const invoiceType = inferInvoiceType(invoice.document_type)

  const netValue = round2(invoice.total - invoice.tax_amount)
  const vatAmount = round2(invoice.tax_amount)
  const totalValue = round2(invoice.total)
  const discountFactor = invoice.subtotal > 0 ? netValue / invoice.subtotal : 1
  const taxRate = netValue > 0 ? vatAmount / netValue : 0
  const vatRatePercent = Math.round(taxRate * 100)
  const vatCategory = vatCategoryFromRate(vatRatePercent)
  let netAccum = 0
  let vatAccum = 0

  const invoiceDetails = lineItems.map((item, idx) => {
    let lineNet: number
    let lineVat: number
    if (idx === lineItems.length - 1) {
      lineNet = round2(netValue - netAccum)
      lineVat = round2(vatAmount - vatAccum)
    } else {
      lineNet = round2(item.total * discountFactor)
      lineVat = round2(lineNet * taxRate)
      netAccum += lineNet
      vatAccum += lineVat
    }

    return {
      lineNumber: idx + 1,
      code: 'SRV',
      name: item.description || 'Υπηρεσία',
      quantity: item.quantity,
      price: round2(item.unit_price * discountFactor),
      netValue: lineNet,
      vatCategory,
      vatPercent: vatRatePercent,
      vatAmount: lineVat,
      measurementUnitName: 'ΤΕΜ',
    }
  })

  const createSimSign = {
    externalSystemId,
    issuerVatNumber: companyVat,
    invoiceIssueDate: issueDate,
    invoiceIssueTime: issueTime,
    invoiceType,
    invoiceSeries: series,
    netValue,
    vatAmount,
    totalValue,
    paymentAmount: totalValue,
    nspCode: DEFAULT_NSP_CODE,
    terminalId: DEFAULT_TERMINAL_ID,
  }

  const sendSimInvoice = {
    invoice: [
      {
        issuer: {
          vatNumber: companyVat,
          country: 'GR',
          branch: 0,
        },
        counterpart: {
          vatNumber: customerVat?.trim() || '000000000',
          country: 'GR',
          branch: 0,
          address: { postalCode: '00000', city: '' },
        },
        invoiceHeader: {
          series,
          aa,
          externalSystemId,
          issueDate,
          issueTime,
          invoiceType,
          currency: 'EUR',
        },
        paymentMethods: [{ type: 3, amount: totalValue }],
        invoiceDetails,
        invoiceSummary: {
          totalNetValue: netValue,
          totalVatAmount: vatAmount,
          totalGrossValue: totalValue,
        },
        invoiceVatAnalysis: [{ vatRate: vatRatePercent, netValue, vatAmount }],
        extra: {
          signature,
          transactionId: externalSystemId,
          tipAmount: 0,
          nspCode: DEFAULT_NSP_CODE,
        },
      },
    ],
  }

  return {
    createSimSign,
    sendSimInvoice,
    metadata: {
      provider: 'bratnet' as const,
      environment,
      providerDocumentId: externalSystemId,
      documentType: invoice.document_type,
      creditCost: estimateBratnetCreditCost(invoice.document_type),
    },
  }
}

async function responseTextSafely(response: Response): Promise<string> {
  try { return await response.text() } catch { return '' }
}

async function responseJsonSafely<T>(response: Response): Promise<T | null> {
  try { return await response.json() as T } catch { return null }
}

export class BratnetInvoiceProvider implements InvoiceProvider {
  private readonly baseUrl: string
  private readonly environment: EInvoicingEnvironment
  private readonly fetchFn: typeof fetch
  private readonly authHeader: string
  private readonly now: () => Date

  constructor(options: BratnetProviderOptions) {
    this.environment = options.environment ?? 'sandbox'
    this.baseUrl = options.baseUrl ?? BRATNET_ENDPOINTS[this.environment]
    this.fetchFn = options.fetchFn ?? fetch
    this.authHeader = buildBasicAuthHeader(options.credentials.username, options.credentials.apiKey)
    this.now = options.now ?? (() => new Date())
  }

  async issueDocument(input: IssueDocumentInput): Promise<IssueDocumentResult> {
    const issueTime = this.now().toTimeString().slice(0, 8)
    const unsignedPayloads = buildBratnetIssuePayloads({ ...input, issueTime, signature: '', environment: this.environment })

    const signRes = await this.fetchFn(`${this.baseUrl}/createSimSign`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(unsignedPayloads.createSimSign),
    })

    if (!signRes.ok) {
      return {
        success: false,
        provider: 'bratnet',
        creditsUsed: estimateBratnetCreditCost('retry'),
        error: `Bratnet createSimSign HTTP ${signRes.status}: ${await responseTextSafely(signRes)}`,
      }
    }

    const signJson = await responseJsonSafely<{ hSignature?: string }>(signRes)
    const signature = signJson?.hSignature ?? ''
    if (!signature) {
      return { success: false, provider: 'bratnet', error: `Bratnet createSimSign: no hSignature in response: ${JSON.stringify(signJson)}`, raw: signJson }
    }

    const payloads = buildBratnetIssuePayloads({ ...input, issueTime, signature, environment: this.environment })
    const sendRes = await this.fetchFn(`${this.baseUrl}/sendSimInvoice`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(payloads.sendSimInvoice),
    })

    const sendJson = await responseJsonSafely<{ responses?: Array<{ invoiceMark?: string | number }> }>(sendRes)
    if (!sendRes.ok) {
      return { success: false, provider: 'bratnet', error: `Bratnet sendSimInvoice HTTP ${sendRes.status}: ${JSON.stringify(sendJson)}`, raw: sendJson }
    }

    const mark = sendJson?.responses?.[0]?.invoiceMark != null ? String(sendJson.responses[0].invoiceMark) : undefined
    if (!mark) {
      return { success: false, provider: 'bratnet', error: `Bratnet sendSimInvoice: no MARK in response: ${JSON.stringify(sendJson)}`, raw: sendJson }
    }

    return {
      success: true,
      provider: 'bratnet',
      mark,
      providerDocumentId: payloads.metadata.providerDocumentId,
      creditsUsed: payloads.metadata.creditCost,
      raw: sendJson,
    }
  }

  async getCredits(): Promise<CreditBalanceResult> {
    // BRATNET has credit packages and per-document consumption, but the confirmed
    // credit-balance endpoint is not wired yet. Keep a stable API surface so UI and
    // backend code can consume it once provider docs/account access are available.
    return {
      provider: 'bratnet',
      remainingCredits: null,
      lowCredit: false,
      checkedAt: this.now().toISOString(),
      error: 'Credit balance endpoint not configured yet',
    }
  }

  private headers(): HeadersInit {
    return {
      Authorization: this.authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }
  }
}
