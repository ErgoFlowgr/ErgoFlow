import { useEffect, useState, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { getJobs, getCustomers, upsertJob, deleteJob, type Job, type Customer } from '../../lib/db'

type Status = Job['status'] | 'all'
type Priority = Job['priority']

const STATUS_COLORS: Record<Job['status'], string> = {
  'pending':     'bg-yellow-500/20 text-yellow-400',
  'in-progress': 'bg-blue-500/20 text-blue-400',
  'completed':   'bg-emerald-500/20 text-emerald-400',
  'cancelled':   'bg-gray-500/20 text-gray-400',
}

const PRIORITY_COLORS: Record<Priority, string> = {
  low:    'bg-gray-500/20 text-gray-400',
  normal: 'bg-blue-500/20 text-blue-400',
  high:   'bg-red-500/20 text-red-400',
}

function PlusIcon()     { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg> }
function TrashIcon()    { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg> }
function EditIcon()     { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg> }
function ListIcon()     { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg> }
function CalendarIcon() { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg> }
function ChevLeft()     { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg> }
function ChevRight()    { return <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg> }

function getCalendarDays(year: number, month: number) {
  const firstDow = new Date(year, month, 1).getDay() // 0=Sun
  const startPad = (firstDow + 6) % 7              // Mon=0 … Sun=6
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const prevYear  = month === 0  ? year - 1 : year
  const prevMonth = month === 0  ? 11 : month - 1
  const nextYear  = month === 11 ? year + 1 : year
  const nextMonth = month === 11 ? 0  : month + 1
  const daysInPrev = new Date(year, month, 0).getDate()

  const fmt = (y: number, m: number, d: number) =>
    `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`

  const days: { dateStr: string; day: number; cur: boolean }[] = []
  for (let i = startPad - 1; i >= 0; i--)
    days.push({ dateStr: fmt(prevYear, prevMonth, daysInPrev - i), day: daysInPrev - i, cur: false })
  for (let d = 1; d <= daysInMonth; d++)
    days.push({ dateStr: fmt(year, month, d), day: d, cur: true })
  let nd = 1
  while (days.length < 42)
    days.push({ dateStr: fmt(nextYear, nextMonth, nd++), day: nd - 1, cur: false })
  return days
}

function formatDate(d: string | null, locale = 'en-GB') {
  if (!d) return '—'
  return new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
}

interface FormState {
  customer_id: string
  customer_name: string
  title: string
  description: string
  status: Job['status']
  priority: Priority
  scheduled_date: string
  notes: string
  keep_indefinitely: boolean
}

const EMPTY_FORM: FormState = {
  customer_id: '', customer_name: '', title: '', description: '',
  status: 'pending', priority: 'normal', scheduled_date: '', notes: '',
  keep_indefinitely: false,
}

export default function Jobs() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language === 'el' ? 'el-GR' : 'en-GB'
  const navigate = useNavigate()
  const [jobs, setJobs] = useState<Job[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [filter, setFilter] = useState<Status>('all')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingJob, setEditingJob] = useState<Job | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [translateError, setTranslateError] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [dateFilter, setDateFilter] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'calendar'>('list')
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1) })
  const [dragStart, setDragStart] = useState<string | null>(null)
  const [dragEnd, setDragEnd]     = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const location = useLocation()

  const load = useCallback(async () => {
    try {
      const [j, c] = await Promise.all([getJobs(), getCustomers()])
      setJobs(j)
      setCustomers(c)
    } catch (e) {
      console.error('[Jobs] load failed:', e)
      setJobs([])
      setCustomers([])
    } finally {
      setLoading(false)
    }
    const state = location.state as { jobId?: string; filterDate?: string } | null
    // Apply date filter if navigated here with a date
    if (state?.filterDate) setDateFilter(state.filterDate)
    // Auto-open a specific job if navigated here with a jobId in state
    const jobId = state?.jobId
    if (jobId) {
      const target = j.find(x => x.id === jobId)
      if (target) {
        setEditingJob(target)
        setTranslateError('')
        setForm({
          customer_id: target.customer_id ?? '',
          customer_name: target.customer_name ?? '',
          title: target.title,
          description: target.description ?? '',
          status: target.status,
          priority: target.priority,
          scheduled_date: target.scheduled_date?.slice(0, 10) ?? '',
          notes: target.notes ?? '',
          keep_indefinitely: !!target.keep_indefinitely,
        })
        setShowForm(true)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const up = () => {
      if (!isDragging) return
      setIsDragging(false)
      // Keep dragStart/dragEnd so right panel shows the selected range
      // (do NOT clear them here — user clears by clicking elsewhere)
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [isDragging])

  const openNew = () => {
    setEditingJob(null)
    setForm(EMPTY_FORM)
    setTranslateError('')
    setShowForm(true)
  }

  const openEdit = (job: Job) => {
    setEditingJob(job)
    setTranslateError('')
    setForm({
      customer_id: job.customer_id ?? '',
      customer_name: job.customer_name ?? '',
      title: job.title,
      description: job.description ?? '',
      status: job.status,
      priority: job.priority,
      scheduled_date: job.scheduled_date?.slice(0, 10) ?? '',
      notes: job.notes ?? '',
      keep_indefinitely: !!job.keep_indefinitely,
    })
    setShowForm(true)
  }

  const handleCustomerChange = (id: string) => {
    const c = customers.find(x => x.id === id)
    setForm(f => ({ ...f, customer_id: id, customer_name: c?.name ?? '' }))
  }

  const handleSave = async () => {
    if (!form.title.trim()) return
    setSaving(true)
    await upsertJob({
      id: editingJob?.id,
      customer_id: form.customer_id || null,
      customer_name: form.customer_name || null,
      title: form.title.trim(),
      description: form.description || null,
      status: form.status,
      priority: form.priority,
      scheduled_date: form.scheduled_date || null,
      completed_date: form.status === 'completed' ? new Date().toISOString().slice(0, 10) : null,
      notes: form.notes || null,
      keep_indefinitely: form.keep_indefinitely ? 1 : 0,
    })
    setSaving(false)
    setShowForm(false)
    await load()
  }

  const handleDelete = async (id: string) => {
    await deleteJob(id)
    setDeleteConfirm(null)
    await load()
  }


  const statusFiltered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter)
  const filtered = dateFilter ? statusFiltered.filter(j => j.scheduled_date?.slice(0, 10) === dateFilter) : statusFiltered

  const counts = {
    all: jobs.length,
    pending: jobs.filter(j => j.status === 'pending').length,
    'in-progress': jobs.filter(j => j.status === 'in-progress').length,
    completed: jobs.filter(j => j.status === 'completed').length,
    cancelled: jobs.filter(j => j.status === 'cancelled').length,
  }

  // Calendar helpers
  const today = new Date().toISOString().slice(0, 10)
  const calYear = calMonth.getFullYear()
  const calMonthNum = calMonth.getMonth()
  const calDays = getCalendarDays(calYear, calMonthNum)
  const jobsByDate = jobs.reduce<Record<string, Job[]>>((acc, job) => {
    if (job.scheduled_date) {
      const d = job.scheduled_date.slice(0, 10)
      if (!acc[d]) acc[d] = []
      acc[d].push(job)
    }
    return acc
  }, {})
  const isInRange = (ds: string) => {  // ds is already YYYY-MM-DD from getCalendarDays
    if (!dragStart || !dragEnd) return false
    const [a, b] = dragStart <= dragEnd ? [dragStart, dragEnd] : [dragEnd, dragStart]
    return ds >= a && ds <= b
  }
  const weekDays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2024, 0, 1 + i))
  )

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-surface-600 shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white">{t('jobs.title')}</h1>
          <p className="text-xs text-gray-500">{jobs.length} {t('jobs.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-surface-700 rounded-xl p-1 gap-1">
            <button onClick={() => setView('list')} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${view === 'list' ? 'bg-surface-500 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`} title="List view"><ListIcon /><span>List</span></button>
            <button onClick={() => setView('calendar')} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${view === 'calendar' ? 'bg-surface-500 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`} title="Calendar view"><CalendarIcon /><span>Calendar</span></button>
          </div>
          <button
            onClick={openNew}
            className="flex items-center gap-2 px-3 py-2 bg-brand-500 hover:bg-brand-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <PlusIcon /> {t('jobs.newJob')}
          </button>
        </div>
      </div>

      {/* Date filter badge */}
      {dateFilter && (
        <div className="flex items-center gap-2 px-6 py-2 bg-brand-500/10 border-b border-brand-500/20 shrink-0">
          <span className="text-xs text-brand-400">📅 {formatDate(dateFilter, locale)}</span>
          <button onClick={() => setDateFilter(null)} className="text-brand-400 hover:text-white text-xs ml-auto">&times; {t('jobs.clearFilter')}</button>
        </div>
      )}

      {/* Filter tabs — list view only */}
      {view === 'list' && <div className="flex gap-1 px-4 sm:px-6 py-3 border-b border-surface-600 overflow-x-auto shrink-0">
        {(['all', 'pending', 'in-progress', 'completed', 'cancelled'] as const).map(s => {
          const labelKey = s === 'all' ? 'filter_all' : s === 'in-progress' ? 'filter_inprogress' : `filter_${s}`
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                filter === s
                  ? 'bg-brand-500/20 text-brand-400'
                  : 'text-gray-500 hover:text-white hover:bg-surface-700'
              }`}
            >
              {t(`jobs.${labelKey}`)} {counts[s] > 0 && <span className="ml-1 opacity-60">{counts[s]}</span>}
            </button>
          )
        })}
      </div>}

      {/* Calendar view */}
      {view === 'calendar' && (
        <div className="flex-1 flex overflow-hidden">

          {/* ── Mini calendar (left panel) ── */}
          <div className="w-72 shrink-0 p-4 border-r border-surface-600 overflow-auto select-none">
            {/* Month nav */}
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setCalMonth(new Date(calYear, calMonthNum - 1, 1))} className="p-1 text-gray-400 hover:text-white hover:bg-surface-700 rounded-lg transition-colors"><ChevLeft /></button>
              <span className="text-sm font-semibold text-white capitalize">{calMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</span>
              <button onClick={() => setCalMonth(new Date(calYear, calMonthNum + 1, 1))} className="p-1 text-gray-400 hover:text-white hover:bg-surface-700 rounded-lg transition-colors"><ChevRight /></button>
            </div>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 mb-0.5">
              {weekDays.map(d => (
                <div key={d} className="text-[10px] text-gray-500 text-center py-0.5 font-medium">{d.slice(0,2)}</div>
              ))}
            </div>
            {/* Day cells — compact circles */}
            <div className="grid grid-cols-7">
              {calDays.map(({ dateStr, day, cur }) => {
                const dayJobs = jobsByDate[dateStr] ?? []
                const inRange = isInRange(dateStr)
                const isToday = dateStr === today
                const isSelected = dragStart === dateStr && !isDragging && dragEnd === dateStr
                const hasPending    = dayJobs.some(j => j.status === 'pending')
                const hasInProgress = dayJobs.some(j => j.status === 'in-progress')
                const hasCompleted  = dayJobs.some(j => j.status === 'completed')
                return (
                  <div
                    key={dateStr}
                    className={`flex flex-col items-center py-0.5 cursor-pointer rounded-lg transition-colors
                      ${inRange ? 'bg-brand-500/20' : ''}
                      ${!cur ? 'opacity-30' : ''}
                    `}
                    onMouseDown={() => { setDragStart(dateStr); setDragEnd(dateStr); setIsDragging(true) }}
                    onMouseEnter={() => { if (isDragging) setDragEnd(dateStr) }}
                  >
                    <div className={`w-8 h-8 flex items-center justify-center rounded-full text-xs font-medium transition-colors
                      ${isToday ? 'bg-brand-500 text-white' : ''}
                      ${isSelected && !isToday ? 'bg-surface-500 text-white' : ''}
                      ${inRange && !isToday ? 'text-brand-300' : ''}
                      ${!isToday && !isSelected && !inRange ? 'text-gray-300 hover:bg-surface-600' : ''}
                    `}>{day}</div>
                    {/* Job indicator dots */}
                    {dayJobs.length > 0 && (
                      <div className="flex gap-0.5 mt-0.5 h-1">
                        {hasPending    && <div className="w-1 h-1 rounded-full bg-yellow-400" />}
                        {hasInProgress && <div className="w-1 h-1 rounded-full bg-blue-400" />}
                        {hasCompleted  && <div className="w-1 h-1 rounded-full bg-emerald-400" />}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Legend */}
            <div className="mt-4 space-y-1.5 border-t border-surface-600 pt-3">
              {[
                { color: 'bg-yellow-400', label: t('jobs.filter_pending') },
                { color: 'bg-blue-400',    label: t('jobs.filter_inprogress') },
                { color: 'bg-emerald-400', label: t('jobs.filter_completed') },
              ].map(({ color, label }) => (
                <div key={label} className="flex items-center gap-2 text-xs text-gray-400">
                  <div className={`w-2 h-2 rounded-full ${color}`} />
                  {label}
                </div>
              ))}
              <p className="text-[10px] text-gray-600 mt-2">{i18n.language === 'el' ? 'Σύρε για επιλογή εύρους' : 'Drag to select a range'}</p>
            </div>
          </div>

          {/* ── Right panel: jobs for selected date(s) ── */}
          <div className="flex-1 overflow-auto p-5">
            {(() => {
              const [rangeA, rangeB] = dragStart && dragEnd
                ? (dragStart <= dragEnd ? [dragStart, dragEnd] : [dragEnd, dragStart])
                : [null, null]
              const rangeJobs = rangeA
                ? jobs.filter(j => j.scheduled_date && j.scheduled_date.slice(0, 10) >= rangeA && j.scheduled_date.slice(0, 10) <= rangeB!)
                : jobs.filter(j => j.scheduled_date?.slice(0, 10) === today)

              const headerDate = rangeA
                ? (rangeA === rangeB
                    ? formatDate(rangeA, locale)
                    : `${formatDate(rangeA, locale)} — ${formatDate(rangeB!, locale)}`)
                : t('dashboard.todayJobs')

              return (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-white">{headerDate}</h3>
                    <button
                      onClick={() => {
                        setEditingJob(null)
                        setForm({ ...EMPTY_FORM, scheduled_date: rangeA ?? today })
                        setTranslateError('')
                        setShowForm(true)
                      }}
                      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg transition-colors"
                    >
                      <PlusIcon /> {t('jobs.newJob')}
                    </button>
                  </div>
                  {rangeJobs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-40 text-gray-500">
                      <p className="text-sm">{t('jobs.noJobs')}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {rangeJobs.map(job => (
                        <div key={job.id} className="bg-surface-800 rounded-xl p-3 flex items-center gap-3 hover:bg-surface-750 transition-colors cursor-pointer" onClick={() => openEdit(job)}>
                          <div className={`w-1 self-stretch rounded-full ${job.priority === 'high' ? 'bg-red-500' : job.priority === 'normal' ? 'bg-blue-500' : 'bg-gray-600'}`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{job.title}</p>
                            {job.customer_name && <p className="text-xs text-gray-400">{job.customer_name}</p>}
                            {job.scheduled_date && rangeA !== rangeB && (
                              <p className="text-xs text-gray-500 mt-0.5">📅 {formatDate(job.scheduled_date, locale)}</p>
                            )}
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${STATUS_COLORS[job.status]}`}>
                            {t(`jobs.status_${job.status.replace('-', '')}`)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )
            })()}
          </div>
        </div>
      )}

      {/* Job list */}
      {view === 'list' && <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-gray-500">
            <p className="text-sm">{t('jobs.noJobs')}</p>
            <p className="text-xs mt-1">{t('jobs.noJobsSub')}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(job => (
              <div key={job.id} className="bg-surface-800 rounded-xl p-4 flex items-start gap-4 hover:bg-surface-750 transition-colors cursor-pointer" onClick={() => openEdit(job)}>
                {/* Priority indicator */}
                <div className={`w-1 self-stretch rounded-full ${
                  job.priority === 'high' ? 'bg-red-500' :
                  job.priority === 'normal' ? 'bg-blue-500' : 'bg-gray-600'
                }`} />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-white">{job.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[job.status]}`}>
                      {t(`jobs.status_${job.status.replace('-', '')}`)}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${PRIORITY_COLORS[job.priority]}`}>
                      {t(`jobs.priority_${job.priority}`)}
                    </span>
                    {!!job.keep_indefinitely && (
                      <span title={t('jobs.keepIndefinitely')} className="text-amber-400 text-xs">📌</span>
                    )}
                  </div>

                  {job.customer_name && (
                    <p className="text-xs text-gray-400 mt-0.5">{job.customer_name}</p>
                  )}
                  {job.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{job.description}</p>
                  )}

                  <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                    {job.scheduled_date && <span>📅 {formatDate(job.scheduled_date, locale)}</span>}
                    {job.completed_date && <span>✅ {t('jobs.done')} {formatDate(job.completed_date, locale)}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  {job.offer_id && (
                    <button
                      onClick={() => navigate('/offers', { state: { offerId: job.offer_id } })}
                      className="p-1.5 text-indigo-400 hover:text-indigo-300 hover:bg-surface-600 rounded-lg transition-colors"
                      title={t('jobs.viewOffer')}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(job)}
                    className="p-1.5 text-gray-500 hover:text-white hover:bg-surface-600 rounded-lg transition-colors"
                  >
                    <EditIcon />
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(job.id)}
                    className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-surface-600 rounded-lg transition-colors"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>}

      {/* Job form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-800 rounded-2xl w-full max-w-lg shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-600">
              <h2 className="text-base font-semibold text-white">{editingJob ? t('jobs.editJob') : t('jobs.newJob')}</h2>
              <button onClick={() => { setShowForm(false); setTranslateError('') }} className="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
            </div>
            {translateError && (
              <p className="px-6 pt-3 text-xs text-red-400">{translateError}</p>
            )}

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Title */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('jobs.titleField')} *</label>
                <input
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500"
                  placeholder={t('jobs.titlePlaceholder')}
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                />
              </div>

              {/* Customer */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('jobs.customer')}</label>
                <select
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                  value={form.customer_id}
                  onChange={e => handleCustomerChange(e.target.value)}
                >
                  <option value="">{t('jobs.noCustomer')}</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Status + Priority */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('jobs.status')}</label>
                  <select
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                    value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value as Job['status'] }))}
                  >
                    <option value="pending">{t('jobs.status_pending')}</option>
                    <option value="in-progress">{t('jobs.status_inprogress')}</option>
                    <option value="completed">{t('jobs.status_completed')}</option>
                    <option value="cancelled">{t('jobs.status_cancelled')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('jobs.priority')}</label>
                  <select
                    className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                    value={form.priority}
                    onChange={e => setForm(f => ({ ...f, priority: e.target.value as Priority }))}
                  >
                    <option value="low">{t('jobs.priority_low')}</option>
                    <option value="normal">{t('jobs.priority_normal')}</option>
                    <option value="high">{t('jobs.priority_high')}</option>
                  </select>
                </div>
              </div>

              {/* Scheduled date */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('jobs.scheduledDate')}</label>
                <input
                  type="date"
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-500"
                  value={form.scheduled_date}
                  onChange={e => setForm(f => ({ ...f, scheduled_date: e.target.value }))}
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('jobs.description')}</label>
                <textarea
                  rows={3}
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 resize-none"
                  placeholder={t('jobs.descriptionPlaceholder')}
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('jobs.notes')}</label>
                <textarea
                  rows={2}
                  className="w-full bg-surface-700 border border-surface-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-brand-500 resize-none"
                  placeholder={t('jobs.notesPlaceholder')}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              {/* Keep indefinitely */}
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded accent-brand-500"
                  checked={form.keep_indefinitely}
                  onChange={e => setForm(f => ({ ...f, keep_indefinitely: e.target.checked }))}
                />
                <span className="text-xs text-gray-400">📌 {t('jobs.keepIndefinitely')}</span>
              </label>
            </div>

            <div className="px-6 py-4 border-t border-surface-600 space-y-3">
              {/* Linked document shortcuts */}
              {editingJob && (editingJob.offer_id || editingJob.invoice_id) && (
                <div className="flex gap-2">
                  {editingJob.offer_id && (
                    <button
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-indigo-400 bg-indigo-500/10 hover:bg-indigo-500/20 rounded-lg transition-colors"
                      onClick={() => { setShowForm(false); navigate('/offers', { state: { offerId: editingJob.offer_id } }) }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                      {t('jobs.viewOffer')}
                    </button>
                  )}
                  {editingJob.invoice_id && (
                    <button
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg transition-colors"
                      onClick={() => { setShowForm(false); navigate('/invoices', { state: { invoiceId: editingJob.invoice_id } }) }}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                      {t('jobs.viewInvoice')}
                    </button>
                  )}
                </div>
              )}
              {editingJob && !editingJob.invoice_id && (
                <button
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium text-gray-400 bg-surface-700 hover:bg-surface-600 hover:text-white rounded-lg transition-colors"
                  onClick={() => {
                    if (!window.confirm('Να δημιουργηθεί τιμολόγιο για αυτή την εργασία;')) return
                    setShowForm(false)
                    navigate('/invoices', { state: { fromJob: { customer_id: editingJob.customer_id, customer_name: editingJob.customer_name, description: editingJob.description, notes: editingJob.notes, job_id: editingJob.id } } })
                  }}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                  {t('jobs.createInvoice')}
                </button>
              )}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2 text-sm text-gray-400 hover:text-white border border-surface-600 rounded-lg transition-colors"
                >
                  {t('jobs.cancel')}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.title.trim()}
                  className="flex-1 py-2 text-sm font-medium bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg transition-colors"
                >
                  {saving ? t('jobs.saving') : t('jobs.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <p className="text-white text-sm font-medium mb-1">{t('jobs.deleteConfirm')}</p>
            <p className="text-gray-400 text-xs mb-4">{t('jobs.deleteWarning')}</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2 text-sm text-gray-400 border border-surface-600 rounded-lg">{t('jobs.cancel')}</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="flex-1 py-2 text-sm font-medium bg-red-500 hover:bg-red-600 text-white rounded-lg">{t('jobs.delete')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
