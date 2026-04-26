import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getInventory, upsertInventoryItem, deleteInventoryItem, type InventoryItem } from '../../lib/db'

const UNITS_EL = ['τεμ.', 'μ.', 'μ²', 'kg', 'ώρα', 'σετ', 'lt']
const UNITS_EN = ['pcs', 'm', 'm²', 'kg', 'hr', 'set', 'lt']

function formatPrice(n: number) {
  return n.toLocaleString('el-GR', { style: 'currency', currency: 'EUR' })
}

export default function Inventory() {
  const { t, i18n } = useTranslation()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [unit, setUnit] = useState('τεμ.')
  const [price, setPrice] = useState(0)
  const [notes, setNotes] = useState('')

  const load = async (q?: string) => {
    try { setItems(await getInventory(q)) } catch { /* table may not exist yet */ }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const timer = setTimeout(() => load(search || undefined), 250)
    return () => clearTimeout(timer)
  }, [search])

  const openNew = () => {
    setEditing(null); setName(''); setCode(''); setUnit('τεμ.'); setPrice(0); setNotes('')
    setShowModal(true)
  }

  const openEdit = (item: InventoryItem) => {
    setEditing(item); setName(item.name); setCode(item.code ?? ''); setUnit(item.unit)
    setPrice(item.price); setNotes(item.notes ?? '')
    setShowModal(true)
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await upsertInventoryItem({ id: editing?.id, name: name.trim(), code: code.trim() || null, unit, price, notes: notes.trim() || null })
      await load(search || undefined)
      setShowModal(false); setEditing(null)
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: string) => {
    await deleteInventoryItem(id); setDeleteConfirm(null); await load(search || undefined)
  }

  return (
    <div className="p-6 h-full overflow-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('inventory.title')}</h1>
          <p className="text-gray-400 text-sm mt-0.5">{items.length} {t('inventory.subtitle')}</p>
        </div>
        <button className="btn-primary" onClick={openNew}>
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('inventory.newItem')}
        </button>
      </div>

      <div className="relative mb-4">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input className="input pl-9 w-full max-w-sm" placeholder={t('inventory.search')} value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {items.length === 0 ? (
        <div className="text-center py-20">
          <svg className="w-12 h-12 text-gray-600 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          <p className="text-gray-500">{t('inventory.noItems')}</p>
          <p className="text-gray-600 text-sm mt-1">{t('inventory.noItemsSub')}</p>
        </div>
      ) : (
        <div className="bg-surface-800 border border-surface-600 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-700 border-b border-surface-600">
              <tr>
                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">{t('inventory.code')}</th>
                <th className="text-left px-4 py-3 text-xs text-gray-400 font-medium">{t('inventory.description')}</th>
                <th className="text-right px-4 py-3 text-xs text-gray-400 font-medium">{t('inventory.unit')}</th>
                <th className="text-right px-4 py-3 text-xs text-gray-400 font-medium">{t('inventory.price')}</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => (
                <tr key={item.id} className={`border-t border-surface-600 hover:bg-surface-700 cursor-pointer transition-colors ${i % 2 === 0 ? '' : 'bg-surface-800/50'}`} onClick={() => openEdit(item)}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-400">{item.code || '—'}</td>
                  <td className="px-4 py-3 font-medium">
                    {item.name}
                    {item.notes && <span className="ml-2 text-xs text-gray-500">{item.notes}</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">{item.unit}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatPrice(item.price)}</td>
                  <td className="px-3 py-3 text-right" onClick={e => e.stopPropagation()}>
                    <button className="text-gray-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-surface-600 transition-colors" onClick={() => setDeleteConfirm(item.id)}>
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
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-surface-600">
              <h2 className="text-lg font-bold">{editing ? t('inventory.editItemTitle') : t('inventory.newItemTitle')}</h2>
              <button className="text-gray-400 hover:text-white" onClick={() => { setShowModal(false); setEditing(null) }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('inventory.description')} *</label>
                <input className="input w-full" value={name} onChange={e => setName(e.target.value)} placeholder={t('inventory.descriptionPlaceholder')} autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('inventory.code')}</label>
                  <input className="input w-full font-mono" value={code} onChange={e => setCode(e.target.value)} placeholder={t('inventory.codePlaceholder')} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('inventory.unit')}</label>
                  <select className="input w-full" value={unit} onChange={e => setUnit(e.target.value)}>
                    {(i18n.language === 'en' ? UNITS_EN : UNITS_EL).map((u, i) => (
                      <option key={u} value={i18n.language === 'en' ? UNITS_EN[i] : UNITS_EL[i]}>{u}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('inventory.price')} (€)</label>
                <input type="number" min="0" step="0.01" className="input w-full" value={price || ''} onFocus={e => { if (e.target.value === '0') e.target.value = '' }} onChange={e => setPrice(parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('inventory.notes')}</label>
                <input className="input w-full" value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('inventory.notesPlaceholder')} />
              </div>
            </div>
            <div className="flex justify-between items-center p-5 border-t border-surface-600">
              <button className="text-gray-400 hover:text-white text-sm" onClick={() => { setShowModal(false); setEditing(null) }}>{t('inventory.cancel')}</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving || !name.trim()}>
                {saving ? t('inventory.saving') : t('inventory.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="font-bold mb-2">{t('inventory.deleteConfirm')}</h3>
            <p className="text-gray-400 text-sm mb-5">{t('inventory.deleteWarning')}</p>
            <div className="flex gap-3">
              <button className="btn-secondary flex-1" onClick={() => setDeleteConfirm(null)}>{t('inventory.cancel')}</button>
              <button className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-lg py-2 font-medium text-sm transition-colors" onClick={() => handleDelete(deleteConfirm)}>{t('inventory.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
