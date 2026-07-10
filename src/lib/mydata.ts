/**
 * e-invoicing submission — Bratnet API on desktop and mobile.
 *
 * Native/mobile path uses the shared provider abstraction in e-invoicing.ts.
 * Electron path is delegated to IPC so it can bypass renderer CORS and read
 * Bratnet credentials from the main-process settings database.
 */
import { BratnetInvoiceProvider } from './e-invoicing'

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
  bratnetUsername?: string
  bratnetApiKey?: string
}

export interface MydataResult {
  success: boolean
  mark?: string
  error?: string
}

export async function submitToMydata(params: MydataParams): Promise<MydataResult> {
  const isElectron = typeof window !== 'undefined' && !!window.electron

  if (isElectron) {
    // Electron: delegate to IPC. Main process reads Bratnet credentials from DB.
    return window.electron!.mydataSubmit({
      invoice: params.invoice,
      lineItems: params.lineItems,
      companyVat: params.companyVat,
      customerVat: params.customerVat,
      documentType: params.invoice.document_type,
    })
  }

  const { bratnetUsername, bratnetApiKey } = params
  if (!bratnetUsername || !bratnetApiKey) {
    return { success: false, error: 'Missing Bratnet credentials. Go to Settings → myDATA / Bratnet.' }
  }

  try {
    const provider = new BratnetInvoiceProvider({
      credentials: { username: bratnetUsername, apiKey: bratnetApiKey },
      environment: 'sandbox',
    })
    const result = await provider.issueDocument({
      invoice: params.invoice,
      lineItems: params.lineItems,
      companyVat: params.companyVat,
      customerVat: params.customerVat,
    })

    return result.success
      ? { success: true, mark: result.mark }
      : { success: false, error: result.error ?? 'Unknown Bratnet error' }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
