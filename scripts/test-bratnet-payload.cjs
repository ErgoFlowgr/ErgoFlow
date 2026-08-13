const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const sourcePath = path.resolve(__dirname, '../src/lib/e-invoicing.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    strict: true,
  },
  fileName: sourcePath,
})

const sandbox = {
  exports: {},
  module: { exports: {} },
  require,
  console,
  Buffer,
  btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
  fetch: async () => { throw new Error('network not used in payload tests') },
}
sandbox.module.exports = sandbox.exports
vm.runInNewContext(transpiled.outputText, sandbox, { filename: sourcePath })

const { buildBratnetIssuePayloads, estimateBratnetCreditCost } = sandbox.module.exports

function build(documentType = 'invoice', taxAmount = 240, total = 1240) {
  return buildBratnetIssuePayloads({
    invoice: {
      number: documentType === 'receipt' ? 'ΑΠΥ-2026-001' : 'ΤΠΥ-2026-001',
      issue_date: '2026-05-06',
      document_type: documentType,
      subtotal: total - taxAmount,
      tax_amount: taxAmount,
      total,
    },
    lineItems: [
      { description: 'Εργασία service', quantity: 1, unit_price: total - taxAmount, total: total - taxAmount },
    ],
    companyVat: '123456789',
    customerVat: '987654321',
    issueTime: '12:34:56',
    signature: 'SIGNATURE',
    environment: 'sandbox',
  })
}

const invoicePayloads = build('invoice')
const invoice = invoicePayloads.sendSimInvoice.invoice[0]
assert.equal(invoicePayloads.createSimSign.invoiceType, '2.1', 'service invoice signing must use Bratnet/myDATA 2.1')
assert.equal(invoice.invoiceHeader.invoiceType, '2.1', 'service invoice sending must use Bratnet/myDATA 2.1')
assert.equal(JSON.stringify(invoice.paymentMethods), JSON.stringify({ paymentMethodDetails: [{ type: 3, amount: 1240 }] }), 'paymentMethods must use Bratnet object shape')
assert.equal(JSON.stringify(invoice.invoiceDetails[0].incomeClassification), JSON.stringify([{ classificationType: 'E3_561_001', classificationCategory: 'category1_3', amount: 1000, id: 1 }]))
assert.equal(invoice.invoiceDetails[0].priceIncludeVAT, 0)

const receiptPayloads = build('receipt')
assert.equal(receiptPayloads.createSimSign.invoiceType, '11.2', 'service receipt signing must use Bratnet/myDATA 11.2')
assert.equal(receiptPayloads.sendSimInvoice.invoice[0].invoiceHeader.invoiceType, '11.2', 'service receipt sending must use Bratnet/myDATA 11.2')
assert.equal(estimateBratnetCreditCost('invoice'), 2)
assert.equal(estimateBratnetCreditCost('receipt'), 1)
assert.throws(() => build('invoice', 190, 1190), /Unsupported VAT rate/, 'unsupported VAT rates must fail before Bratnet submission')

console.log('Bratnet payload tests passed')
