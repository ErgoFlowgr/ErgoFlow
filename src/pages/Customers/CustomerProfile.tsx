import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  getCustomers, getCallsByCustomer, getJobsByCustomer, getOffersByCustomer, getInvoicesByCustomer,
  type Customer, type Call, type Job, type Offer, type Invoice,
} from '../../lib/db'

type Tab = 'info' | 'jobs' | 'offers' | 'invoices' | 'calls'

function priorityDot(p: string) {
  return p === 'high' ? 'bg-red-400' : p === 'normal' ? 'bg-yellow-400' : 'bg-gray-500'
}
function jobStatusColor(s: string) {
  return s === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
         s === 'in-progress' ? 'bg-yellow-500/20 text-yellow-400' :
         s === 'cancelled' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'
}
function offerStatusColor(s: string) {
  return s === 'accepted' ? 'bg-emerald-500/20 text-emerald-400' :
         s === 'rejected' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
}
function invoiceStatusColor(s: string) {
  return s === 'paid' ? 'bg-emerald-500/20 text-emerald-400' :
         s === 'draft' ? 'bg-gray-500/20 text-gray-400' : 'bg-yellow-500/20 text-yellow-400'
}

export default function CustomerProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'el' ? 'el-GR' : 'en-GB'

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [calls, setCalls] = useState<Call[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [offers, setOffers] = useState<Offer[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [tab, setTab] = useState<Tab>('info')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    Promise.all([
      getCustomers(),
      getCallsByCustomer(id),
      getJobsByCustomer(id),
      getOffersByCustomer(id).catch(() => [] as Offer[]),
      getInvoicesByCustomer(id).catch(() => [] as Invoice[]),
    ]).then(([customers, c, j, o, inv]) => {
      setCustomer(customers.find(cu => cu.id === id) ?? null)
      setCalls(c)
      setJobs(j)
      setOffers(o)
      setInvoices(inv)
      setLoading(false)
    })
  }, [id])

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!customer) return (
    <div className="p-6 text-gray-400">{t('customers.notFound')}</div>
  )

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'info',   label: t('customers.tabInfo'),   count: 0 },
    { key: 'jobs',   label: t('customers.tabJobs'),   count: jobs.length },
    { key: 'offers', label: t('customers.tabOffers'), count: offers.length },
    { key: 'invoices', label: t('customers.tabInvoices'), count: invoices.length },
    { key: 'calls',  label: t('customers.tabCalls'),  count: calls.length },
  ]

  const initial = (customer.name ?? '?')[0]?.toUpperCase()

  return (
    <div className="p-6 h-full overflow-auto max-w-3xl mx-auto">
      {/* Back button */}
      <button
        className="flex items-center gap-2 text-sm text-gray-400 hover:text-white mb-5 transition-colors"
        onClick={() => navigate('/customers')}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        {t('customers.title')}
      </button>

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 rounded-full bg-brand-500/20 flex items-center justify-center text-xl font-bold text-brand-400 shrink-0">
          {initial}
        </div>
        <div>
          <h1 className="text-xl font-bold">{customer.name}</h1>
          {customer.company_name && <p className="text-gray-400 text-sm">{customer.company_name}</p>}
          {customer.phone && <p className="text-gray-500 text-sm">{customer.phone}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-800 p-1 rounded-xl mb-6">
        {tabs.map(tb => (
          <button
            key={tb.key}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === tb.key ? 'bg-surface-700 text-white' : 'text-gray-400 hover:text-white'
            }`}
            onClick={() => setTab(tb.key)}
          >
            {tb.label}
            {tb.count > 0 && <span className="ml-1.5 text-xs bg-surface-600 px-1.5 py-0.5 rounded-full">{tb.count}</span>}
          </button>
        ))}
      </div>

      {/* Info tab */}
      {tab === 'info' && (
        <div className="bg-surface-800 border border-surface-600 rounded-xl p-5 space-y-3">
          {[
            [t('customers.companyName'), customer.company_name],
            [t('customers.cocNumber'), customer.coc_number],
            [t('customers.vatNumber'), customer.vat_number],
            [t('customers.phone'), customer.phone],
            [t('customers.mobile'), customer.mobile],
            [t('customers.email'), customer.email],
            [t('customers.address'), [customer.address, customer.postal_code, customer.city, customer.country].filter(Boolean).join(', ')],
          ].filter(([, v]) => v).map(([k, v]) => (
            <div key={k as string} className="flex justify-between text-sm gap-4">
              <span className="text-gray-400 shrink-0">{k}</span>
              <span className="font-medium text-right">{v}</span>
            </div>
          ))}
          {customer.notes && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1 mt-2">{t('customers.notes')}</p>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{customer.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Jobs tab */}
      {tab === 'jobs' && (
        <div className="space-y-2">
          {jobs.length === 0 ? (
            <p className="text-center py-10 text-gray-500 text-sm">{t('jobs.noJobs')}</p>
          ) : jobs.map(job => (
            <div key={job.id} className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-surface-700 transition-colors" onClick={() => navigate('/jobs')}>
              <div className={`w-2 h-2 rounded-full shrink-0 ${priorityDot(job.priority)}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{job.title}</p>
                {job.scheduled_date && <p className="text-xs text-gray-500">{new Date(job.scheduled_date).toLocaleDateString(locale)}</p>}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${jobStatusColor(job.status)}`}>
                {t(`jobs.status_${job.status}`)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Offers tab */}
      {tab === 'offers' && (
        <div className="space-y-2">
          {offers.length === 0 ? (
            <p className="text-center py-10 text-gray-500 text-sm">{t('offers.noOffers')}</p>
          ) : offers.map(off => (
            <div key={off.id} className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-surface-700 transition-colors" onClick={() => navigate('/offers')}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{off.number}</p>
                {off.issue_date && <p className="text-xs text-gray-500">{off.issue_date}</p>}
              </div>
              <p className="text-sm font-semibold shrink-0">{off.total.toLocaleString(locale, { style: 'currency', currency: 'EUR' })}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${offerStatusColor(off.status)}`}>
                {t(`offers.status_${off.status}`)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Invoices tab */}
      {tab === 'invoices' && (
        <div className="space-y-2">
          {invoices.length === 0 ? (
            <p className="text-center py-10 text-gray-500 text-sm">{t('invoices.noInvoices')}</p>
          ) : invoices.map(inv => (
            <div key={inv.id} className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-surface-700 transition-colors" onClick={() => navigate('/invoices')}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-medium truncate">{inv.number}</p>
                  <span className="text-[10px] uppercase tracking-wide text-gray-500 shrink-0">
                    {inv.document_type === 'receipt' ? t('invoices.typeReceipt') : t('invoices.typeInvoice')}
                  </span>
                </div>
                {inv.issue_date && <p className="text-xs text-gray-500">{new Date(inv.issue_date).toLocaleDateString(locale)}</p>}
              </div>
              <p className="text-sm font-semibold shrink-0">{inv.total.toLocaleString(locale, { style: 'currency', currency: 'EUR' })}</p>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${invoiceStatusColor(inv.status)}`}>
                {t(`invoices.status_${inv.status}`)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Calls tab */}
      {tab === 'calls' && (
        <div className="space-y-2">
          {calls.length === 0 ? (
            <p className="text-center py-10 text-gray-500 text-sm">{t('calls.noData')}</p>
          ) : calls.map(call => (
            <div key={call.id} className="bg-surface-800 border border-surface-600 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  call.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                  call.status === 'missed'    ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
                }`}>{call.status}</span>
                <span className="text-xs text-gray-500">
                  {call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s` : '—'}
                </span>
              </div>
              <p className="text-xs text-gray-400">{call.started_at ? new Date(call.started_at).toLocaleString(locale) : '—'}</p>
              {call.summary && <p className="text-xs text-gray-300 mt-1.5 line-clamp-2">{call.summary}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
