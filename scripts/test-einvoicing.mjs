import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ts from 'typescript'

const sourcePath = new URL('../src/lib/e-invoicing.ts', import.meta.url)
const source = readFileSync(sourcePath, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    strict: true,
  },
}).outputText
const tempDir = mkdtempSync(join(tmpdir(), 'ergoflow-einvoicing-test-'))
const modulePath = join(tempDir, 'e-invoicing.mjs')
writeFileSync(modulePath, transpiled)
const mod = await import(modulePath)

const baseInvoice = {
  number: 'ΤΠΥ-2026-001',
  issue_date: '2026-05-21',
  document_type: 'invoice',
  subtotal: 100,
  tax_amount: 24,
  total: 124,
}
const items = [
  { description: 'Service A', quantity: 1, unit_price: 60, total: 60 },
  { description: 'Service B', quantity: 1, unit_price: 40, total: 40 },
]

assert.equal(mod.BRATNET_ENDPOINTS.sandbox, 'https://einvoicing-dev-api.etimologiera.gr/v4')
assert.equal(mod.BRATNET_ENDPOINTS.production, 'https://einvoicing-api.etimologiera.gr/v4')
assert.equal(mod.buildBasicAuthHeader('user', 'api-key'), 'Basic dXNlcjphcGkta2V5')
assert.deepEqual(mod.parseDocumentNumber('ΤΠΥ-2026-001'), { series: 'ΤΠΥ', aa: 1 })
assert.deepEqual(mod.parseDocumentNumber('INV-2026-123'), { series: 'INV', aa: 123 })
assert.equal(mod.estimateBratnetCreditCost('receipt'), 1)
assert.equal(mod.estimateBratnetCreditCost('invoice'), 2)
assert.equal(mod.estimateBratnetCreditCost('b2g'), 4)
assert.equal(mod.estimateBratnetCreditCost('retry'), 1)

const payloads = mod.buildBratnetIssuePayloads({
  invoice: baseInvoice,
  lineItems: items,
  companyVat: '123456789',
  customerVat: '987654321',
  issueTime: '10:20:30',
  signature: 'signed-hash',
})

assert.equal(payloads.createSimSign.externalSystemId, 'ΤΠΥ-2026-001')
assert.equal(payloads.createSimSign.invoiceSeries, 'ΤΠΥ')
assert.equal(payloads.createSimSign.netValue, 100)
assert.equal(payloads.createSimSign.vatAmount, 24)
assert.equal(payloads.createSimSign.totalValue, 124)
assert.equal(payloads.createSimSign.terminalId, 'EF-001')

const invoice = payloads.sendSimInvoice.invoice[0]
assert.equal(invoice.issuer.vatNumber, '123456789')
assert.equal(invoice.counterpart.vatNumber, '987654321')
assert.equal(invoice.invoiceHeader.series, 'ΤΠΥ')
assert.equal(invoice.invoiceHeader.aa, 1)
assert.equal(invoice.invoiceHeader.invoiceType, '1.1')
assert.equal(invoice.invoiceDetails.length, 2)
assert.equal(invoice.invoiceDetails[0].vatCategory, 1)
assert.equal(invoice.invoiceSummary.totalNetValue, 100)
assert.equal(invoice.invoiceSummary.totalVatAmount, 24)
assert.equal(invoice.invoiceSummary.totalGrossValue, 124)
assert.equal(invoice.extra.signature, 'signed-hash')

const receiptPayloads = mod.buildBratnetIssuePayloads({
  invoice: { ...baseInvoice, document_type: 'receipt' },
  lineItems: items,
  companyVat: '123456789',
  customerVat: '',
  issueTime: '10:20:30',
  signature: 'signed-hash',
})
assert.equal(receiptPayloads.sendSimInvoice.invoice[0].counterpart.vatNumber, '000000000')
assert.equal(receiptPayloads.metadata.creditCost, 1)
assert.equal(payloads.metadata.creditCost, 2)
assert.equal(payloads.metadata.environment, 'sandbox')

console.log('e-invoicing provider tests passed')
