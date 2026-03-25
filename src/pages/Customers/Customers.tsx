import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getCustomers, upsertCustomer, deleteCustomer, getCallsByCustomer, type Customer, type Call, uuid } from '../../lib/db'

const INPUT = 'w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500'
const LABEL = 'block text-xs text-gray-400 mb-1'

interface EditState {
  id?: string
  company_name: string
  coc_number: string
  vat_number: string
  salutation: string
  first_name: string
  last_name: string
  email: string
  phone: string
  mobile: string
  fax: string
  address: string
  postal_code: string
  city: string
  country: string
  notes: string
}

const EMPTY_EDIT: EditState = {
  company_name: '', coc_number: '', vat_number: '',
  salutation: '', first_name: '', last_name: '',
  email: '', phone: '', mobile: '', fax: '',
  address: '', postal_code: '', city: '', country: '',
  notes: '',
}

function customerToEdit(c: Customer): EditState {
  return {
    id: c.id,
    company_name: c.company_name ?? '',
    coc_number: c.coc_number ?? '',
    vat_number: c.vat_number ?? '',
    salutation: c.salutation ?? '',
    first_name: c.first_name ?? '',
    last_name: c.last_name ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    mobile: c.mobile ?? '',
    fax: c.fax ?? '',
    address: c.address ?? '',
    postal_code: c.postal_code ?? '',
    city: c.city ?? '',
    country: c.country ?? '',
    notes: c.notes ?? '',
  }
}

export default function Customers() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<EditState | null>(null)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [customerCalls, setCustomerCalls] = useState<Call[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setCustomers(await getCustomers(search || undefined))
  }, [search])

  useEffect(() => { load() }, [load])

  const selectCustomer = (c: Customer) => {
    setSelected(c)
    getCallsByCustomer(c.id).then(setCustomerCalls)
  }

  const openNew = () => { setEditing({ ...EMPTY_EDIT }); setShowModal(true) }
  const openEdit = (c: Customer) => { setEditing(customerToEdit(c)); setShowModal(true) }

  const field = (key: keyof EditState) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setEditing(p => p ? { ...p, [key]: e.target.value } : p)

  const save = async () => {
    if (!editing) return
    const displayName =
      editing.company_name.trim() ||
      [editing.first_name, editing.last_name].filter(Boolean).join(' ').trim() ||
      t('customers.unnamed')
    setSaving(true)
    await upsertCustomer({
      id: editing.id ?? uuid(),
      name: displayName,
      company_name: editing.company_name || null,
      coc_number: editing.coc_number || null,
      vat_number: editing.vat_number || null,
      salutation: editing.salutation || null,
      first_name: editing.first_name || null,
      last_name: editing.last_name || null,
      email: editing.email || null,
      phone: editing.phone || null,
      mobile: editing.mobile || null,
      fax: editing.fax || null,
      address: editing.address || null,
      postal_code: editing.postal_code || null,
      city: editing.city || null,
      country: editing.country || null,
      notes: editing.notes || null,
    })
    setSaving(false)
    setShowModal(false)
    setEditing(null)
    load()
  }

  const del = async (id: string) => {
    if (!confirm(t('common.confirm') + '?')) return
    await deleteCustomer(id)
    setSelected(null)
    load()
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{t('customers.title')}</h1>
          <button
            className="flex items-center gap-2 px-3 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors"
            onClick={openNew}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t('customers.add')}
          </button>
        </div>

        {/* Search */}
        <input
          className={INPUT + ' mb-4 max-w-sm'}
          placeholder={t('customers.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {customers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="w-16 h-16 rounded-full bg-surface-700 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <p className="text-gray-300 font-medium">{t('customers.noData')}</p>
            <p className="text-gray-500 text-sm mt-1">{t('customers.noDataSub')}</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {customers.map(c => (
              <div
                key={c.id}
                onClick={() => selectCustomer(c)}
                className={`bg-surface-800 border border-surface-600 rounded-xl p-4 cursor-pointer flex items-center gap-4 hover:border-brand-500/50 transition-colors ${selected?.id === c.id ? 'border-brand-500' : ''}`}
              >
                <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-500 font-bold shrink-0">
                  {c.name[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{c.name}</p>
                  <p className="text-sm text-gray-400 truncate">
                    {[c.company_name && c.company_name !== c.name ? c.company_name : null, c.phone ?? c.email].filter(Boolean).join(' · ') || '—'}
                  </p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); openEdit(c) }}
                  className="p-1.5 text-gray-500 hover:text-white hover:bg-surface-600 rounded-lg transition-colors shrink-0"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="w-96 border-l border-surface-600 bg-surface-800 flex flex-col overflow-hidden">
          <div className="p-5 border-b border-surface-600 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-500 font-bold">
                {selected.name[0]?.toUpperCase() ?? '?'}
              </div>
              <div>
                <h2 className="font-semibold">{selected.name}</h2>
                {selected.company_name && selected.company_name !== selected.name && (
                  <p className="text-xs text-gray-400">{selected.company_name}</p>
                )}
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>

          <div className="flex-1 overflow-auto p-5 space-y-4">
            {/* Business info */}
            <div className="space-y-1.5">
              {[
                [t('customers.cocNumber'), selected.coc_number],
                [t('customers.vatNumber'), selected.vat_number],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k as string} className="flex justify-between text-sm">
                  <span className="text-gray-400">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>

            {/* Contact info */}
            <div className="space-y-1.5">
              {[
                [t('customers.phone'), selected.phone],
                [t('customers.mobile'), selected.mobile],
                [t('customers.fax'), selected.fax],
                [t('customers.email'), selected.email],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k as string} className="flex justify-between text-sm">
                  <span className="text-gray-400">{k}</span>
                  <span className="font-medium">{v}</span>
                </div>
              ))}
            </div>

            {/* Address */}
            {(selected.address || selected.city || selected.country) && (
              <div className="text-sm">
                <p className="text-gray-400 text-xs mb-1">{t('customers.address')}</p>
                <p className="text-gray-200">
                  {[selected.address, [selected.postal_code, selected.city].filter(Boolean).join(' '), selected.country].filter(Boolean).join(', ')}
                </p>
              </div>
            )}

            {selected.notes && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t('customers.notes')}</p>
                <p className="text-sm text-gray-300 whitespace-pre-wrap">{selected.notes}</p>
              </div>
            )}

            {/* Last call summary */}
            {customerCalls[0]?.summary && (
              <div className="bg-brand-500/10 border border-brand-500/20 rounded-lg p-3">
                <p className="text-xs font-semibold text-brand-500 uppercase tracking-wider mb-1.5">Last Call Summary</p>
                <p className="text-sm text-gray-200 leading-relaxed">{customerCalls[0].summary}</p>
                <p className="text-xs text-gray-500 mt-2">
                  {customerCalls[0].started_at ? new Date(customerCalls[0].started_at).toLocaleString() : ''}
                </p>
              </div>
            )}

            {/* Call history */}
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Call History ({customerCalls.length})</p>
              {customerCalls.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No calls yet</p>
              ) : (
                <div className="space-y-2">
                  {customerCalls.map(call => (
                    <div key={call.id} className="bg-surface-700 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          call.status === 'completed' ? 'bg-green-900/40 text-emerald-400' :
                          call.status === 'missed'    ? 'bg-red-900/40 text-red-400' :
                                                        'bg-yellow-900/40 text-yellow-400'
                        }`}>{call.status}</span>
                        <span className="text-xs text-gray-500">
                          {call.duration_seconds ? `${Math.floor(call.duration_seconds / 60)}m ${call.duration_seconds % 60}s` : '—'}
                        </span>
                      </div>
                      <p className="text-xs text-gray-400">
                        {call.started_at ? new Date(call.started_at).toLocaleString() : '—'}
                      </p>
                      {call.summary && (
                        <p className="text-xs text-gray-300 mt-1.5 line-clamp-2">{call.summary}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="p-4 border-t border-surface-600 flex gap-2 shrink-0">
            <button
              className="flex-1 py-2 text-sm text-brand-400 hover:text-brand-300 border border-brand-500/30 hover:border-brand-500 rounded-lg transition-colors"
              onClick={() => navigate(`/customers/${selected.id}`)}
            >
              {t('customers.viewProfile')}
            </button>
            <button
              className="flex-1 py-2 text-sm text-gray-300 hover:text-white border border-surface-600 hover:border-surface-400 rounded-lg transition-colors"
              onClick={() => openEdit(selected)}
            >
              ✏️ Edit
            </button>
            <button
              className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
              onClick={() => del(selected.id)}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && editing !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setShowModal(false)}>
          <div className="bg-surface-800 rounded-2xl w-full max-w-3xl shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-600">
              <h2 className="text-base font-semibold text-white">
                {editing.id ? t('customers.editContact') : t('customers.newContact')}
              </h2>
              <button onClick={() => setShowModal(false)} className="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
            </div>

            {/* Two-column form */}
            <div className="p-6 grid grid-cols-2 gap-8 max-h-[70vh] overflow-y-auto">

              {/* LEFT: Client details */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-4">{t('customers.clientDetails')}</h3>
                <div className="space-y-3">
                  <div>
                    <label className={LABEL}>{t('customers.companyName')}</label>
                    <input className={INPUT} value={editing.company_name} onChange={field('company_name')} />
                  </div>
                  <div>
                    <label className={LABEL}>{t('customers.cocNumber')}</label>
                    <input className={INPUT} value={editing.coc_number} onChange={field('coc_number')} />
                  </div>
                  <div>
                    <label className={LABEL}>{t('customers.vatNumber')}</label>
                    <input className={INPUT} value={editing.vat_number} onChange={field('vat_number')} />
                  </div>
                  <div>
                    <label className={LABEL}>{t('customers.contactPerson')}</label>
                    <div className="flex gap-2">
                      <select
                        className="bg-surface-700 border border-surface-600 rounded-lg px-2 py-2 text-sm text-white focus:outline-none focus:border-brand-500 w-20"
                        value={editing.salutation}
                        onChange={field('salutation')}
                      >
                        <option value="">—</option>
                        <option value="Sir">Sir</option>
                        <option value="Madam">Madam</option>
                        <option value="Dr">Dr</option>
                      </select>
                      <input className={INPUT} placeholder={t('customers.firstName')} value={editing.first_name} onChange={field('first_name')} />
                      <input className={INPUT} placeholder={t('customers.lastName')} value={editing.last_name} onChange={field('last_name')} />
                    </div>
                  </div>
                  <div>
                    <label className={LABEL}>{t('customers.address')}</label>
                    <input className={INPUT} value={editing.address} onChange={field('address')} />
                  </div>
                  <div>
                    <label className={LABEL}>{t('customers.postalCode')} &amp; {t('customers.city')}</label>
                    <div className="flex gap-2">
                      <input className={INPUT + ' w-28'} placeholder={t('customers.postalCode')} value={editing.postal_code} onChange={field('postal_code')} />
                      <input className={INPUT} placeholder={t('customers.city')} value={editing.city} onChange={field('city')} />
                    </div>
                  </div>
                  <div>
                    <label className={LABEL}>{t('customers.country')}</label>
                    <input className={INPUT} value={editing.country} onChange={field('country')} />
                  </div>
                </div>
              </div>

              {/* RIGHT: Contact details */}
              <div>
                <h3 className="text-sm font-semibold text-white mb-4">{t('customers.contactDetails')}</h3>
                <div className="space-y-3">
                  <div>
                    <label className={LABEL}>{t('customers.email')}</label>
                    <input type="email" className={INPUT} value={editing.email} onChange={field('email')} />
                  </div>
                  <div>
                    <label className={LABEL}>{t('customers.phone')}</label>
                    <input type="tel" className={INPUT} value={editing.phone} onChange={field('phone')} />
                  </div>
                  <div>
                    <label className={LABEL}>{t('customers.mobile')}</label>
                    <input type="tel" className={INPUT} value={editing.mobile} onChange={field('mobile')} />
                  </div>
                  <div>
                    <label className={LABEL}>{t('customers.fax')}</label>
                    <input type="tel" className={INPUT} value={editing.fax} onChange={field('fax')} />
                  </div>
                  <div>
                    <label className={LABEL}>{t('customers.notes')}</label>
                    <textarea
                      rows={4}
                      className={INPUT + ' resize-none'}
                      value={editing.notes}
                      onChange={field('notes')}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex gap-3 px-6 py-4 border-t border-surface-600">
              <button
                onClick={() => setShowModal(false)}
                className="flex-1 py-2 text-sm text-gray-400 hover:text-white border border-surface-600 rounded-lg transition-colors"
              >
                {t('customers.cancel')}
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="flex-1 py-2 text-sm font-medium bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg transition-colors"
              >
                {saving ? '...' : t('customers.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
