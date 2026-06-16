import { Capacitor } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import { ipc, isElectron } from './electron'
import { getJobs, getOffers, type Job, type Offer } from './db'

type ReminderTarget = {
  id: string
  title: string
  customerName?: string | null
}

const electronTimers = new Map<number, ReturnType<typeof setTimeout>>()
const MAX_ELECTRON_TIMER_DELAY_MS = 2_147_483_647

function stableNotificationId(seed: string): number {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }
  return Math.abs(hash % 2_000_000_000) + 1
}

function dateAtLocalHour(dateValue: string | null | undefined, hour: number): Date | null {
  if (!dateValue) return null
  const [year, month, day] = dateValue.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return null
  return new Date(year, month - 1, day, hour, 0, 0, 0)
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date)
  copy.setDate(copy.getDate() + days)
  return copy
}

function isFuture(date: Date): boolean {
  return date.getTime() > Date.now() + 60_000
}

async function ensureAndroidNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false

  const permission = await LocalNotifications.checkPermissions()
  if (permission.display === 'granted') return true

  const requested = await LocalNotifications.requestPermissions()
  return requested.display === 'granted'
}

async function cancelNativeNotifications(ids: number[]): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  await LocalNotifications.cancel({ notifications: ids.map(id => ({ id })) })
}

function cancelElectronNotifications(ids: number[]) {
  for (const id of ids) {
    const timer = electronTimers.get(id)
    if (timer) clearTimeout(timer)
    electronTimers.delete(id)
  }
}

function scheduleElectronReminder(id: number, title: string, body: string, at: Date) {
  const delay = at.getTime() - Date.now()

  if (delay <= 0) {
    void ipc.notify(title, body)
    electronTimers.delete(id)
    return
  }

  const timer = setTimeout(() => {
    electronTimers.delete(id)
    if (delay > MAX_ELECTRON_TIMER_DELAY_MS) {
      scheduleElectronReminder(id, title, body, at)
      return
    }
    void ipc.notify(title, body)
  }, Math.min(delay, MAX_ELECTRON_TIMER_DELAY_MS))

  electronTimers.set(id, timer)
}

async function scheduleReminder(id: number, title: string, body: string, at: Date): Promise<void> {
  if (!isFuture(at)) return

  if (Capacitor.isNativePlatform()) {
    const allowed = await ensureAndroidNotificationPermission()
    if (!allowed) return

    await LocalNotifications.schedule({
      notifications: [{
        id,
        title,
        body,
        schedule: { at },
      }],
    })
    return
  }

  if (isElectron) {
    scheduleElectronReminder(id, title, body, at)
  }
}

export async function cancelJobReminder(jobId: string): Promise<void> {
  const id = stableNotificationId(`job:${jobId}`)
  cancelElectronNotifications([id])
  await cancelNativeNotifications([id])
}

export async function scheduleJobReminder(job: ReminderTarget & { scheduledDate?: string | null; status?: string | null }): Promise<void> {
  const id = stableNotificationId(`job:${job.id}`)
  await cancelJobReminder(job.id)

  if (!job.scheduledDate || job.status === 'completed' || job.status === 'cancelled') return

  const at = dateAtLocalHour(job.scheduledDate, 8)
  if (!at) return

  const customer = job.customerName ? ` — ${job.customerName}` : ''
  await scheduleReminder(
    id,
    'Ergoflow job reminder',
    `${job.title}${customer} is scheduled for today.`,
    at,
  )
}

export async function cancelOfferExpiryReminders(offerId: string): Promise<void> {
  const ids = [
    stableNotificationId(`offer:${offerId}:before`),
    stableNotificationId(`offer:${offerId}:expiry`),
  ]
  cancelElectronNotifications(ids)
  await cancelNativeNotifications(ids)
}

export async function scheduleOfferExpiryReminders(offer: ReminderTarget & { expiryDate?: string | null; status?: string | null }): Promise<void> {
  const beforeId = stableNotificationId(`offer:${offer.id}:before`)
  const expiryId = stableNotificationId(`offer:${offer.id}:expiry`)
  await cancelOfferExpiryReminders(offer.id)

  if (!offer.expiryDate || offer.status !== 'pending') return

  const expiryAt = dateAtLocalHour(offer.expiryDate, 9)
  if (!expiryAt) return

  const beforeAt = addDays(expiryAt, -1)
  const customer = offer.customerName ? ` — ${offer.customerName}` : ''

  await scheduleReminder(
    beforeId,
    'Ergoflow offer expiring soon',
    `${offer.title}${customer} expires tomorrow.`,
    beforeAt,
  )

  await scheduleReminder(
    expiryId,
    'Ergoflow offer expires today',
    `${offer.title}${customer} expires today.`,
    expiryAt,
  )
}

export async function rescheduleAllReminders(): Promise<void> {
  const [jobs, offers] = await Promise.all([
    getJobs(),
    getOffers(),
  ])

  await Promise.all([
    ...jobs.map((job: Job) => scheduleJobReminder({
      id: job.id,
      title: job.title,
      customerName: job.customer_name,
      scheduledDate: job.scheduled_date,
      status: job.status,
    })),
    ...offers.map((offer: Offer) => scheduleOfferExpiryReminders({
      id: offer.id,
      title: offer.number,
      customerName: offer.customer_name,
      expiryDate: offer.expiry_date,
      status: offer.status,
    })),
  ])
}
