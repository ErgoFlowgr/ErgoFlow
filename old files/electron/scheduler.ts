/**
 * Overseer — Daily Health Check + AI Briefing
 *
 * Runs every morning at user-specified time.
 * 1. Performs health checks on all system components
 * 2. Stores results in overseer_log (persistent memory)
 * 3. Generates an AI briefing on CRM stats
 * 4. Reports any errors to the user via notification + in-app panel
 */
import { BrowserWindow, Notification } from 'electron'
import { getDb } from './db'
import { getSecret } from './keychain'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config'

let lastBriefingDate = ''

// ── Types ──────────────────────────────────────────────────────────────────

interface CheckResult {
  name: string
  status: 'ok' | 'error' | 'warning'
  message: string
}

interface OverseerReport {
  status: 'ok' | 'degraded' | 'critical'
  checks: CheckResult[]
  briefing: string
  errors: CheckResult[]
  checkedAt: string
}

// ── Entry point ────────────────────────────────────────────────────────────

export function setupScheduler(win: BrowserWindow | null) {
  // Check every minute whether it's time for the briefing
  setInterval(() => checkSchedule(win), 60_000)
}

export async function runOverseerNow(win: BrowserWindow | null): Promise<void> {
  const db = getDb()
  const settings = db.prepare('SELECT * FROM settings WHERE id = ?').get('main') as {
    ai_provider: string
    ollama_url: string
    ollama_briefing_model: string
    language: string
  } | undefined

  const report = await runOverseer(settings ?? { ai_provider: 'claude', ollama_url: 'http://localhost:11434', language: 'en' })
  persistReport(report)
  notifyUser(report, win)
  win?.webContents.send('overseer:report', report)
}

async function checkSchedule(win: BrowserWindow | null) {
  const db = getDb()
  const settings = db.prepare('SELECT * FROM settings WHERE id = ?').get('main') as {
    briefing_enabled: number
    briefing_time: string
    ai_provider: string
    ollama_url: string
    ollama_briefing_model: string
    language: string
  } | undefined

  if (!settings?.briefing_enabled) return

  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  if (currentTime !== settings.briefing_time || lastBriefingDate === today) return
  lastBriefingDate = today

  const report = await runOverseer(settings)
  persistReport(report)
  notifyUser(report, win)
  win?.webContents.send('overseer:report', report)
}

// ── Health checks ──────────────────────────────────────────────────────────

async function runOverseer(settings: {
  ai_provider: string
  ollama_url: string
  language?: string
}): Promise<OverseerReport> {
  const checks: CheckResult[] = []

  // 1. SQLite database
  checks.push(checkDatabase())

  // 2. Supabase connection
  checks.push(await checkSupabase())

  // 3. VAPI API key
  checks.push(await checkVapi())

  // 4. AI provider (Claude or Ollama)
  checks.push(await checkAiProvider(settings))

  // 5. Sync queue backlog
  checks.push(checkSyncQueue())

  const errors = checks.filter(c => c.status === 'error')
  const warnings = checks.filter(c => c.status === 'warning')

  const overallStatus: OverseerReport['status'] =
    errors.length > 0 ? 'critical' :
    warnings.length > 0 ? 'degraded' : 'ok'

  // Generate AI briefing (pass errors context if any)
  const briefing = await generateBriefing(settings, errors)

  return {
    status: overallStatus,
    checks,
    briefing,
    errors,
    checkedAt: new Date().toISOString(),
  }
}

function checkDatabase(): CheckResult {
  try {
    const db = getDb()
    db.prepare('SELECT 1').get()
    const customerCount = (db.prepare('SELECT COUNT(*) as n FROM customers').get() as { n: number }).n
    return { name: 'Database', status: 'ok', message: `SQLite healthy — ${customerCount} customers` }
  } catch (err) {
    return { name: 'Database', status: 'error', message: `SQLite error: ${String(err)}` }
  }
}

async function checkSupabase(): Promise<CheckResult> {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_ANON_KEY } })
    if (res.ok) {
      return { name: 'Supabase', status: 'ok', message: 'Supabase reachable' }
    }
    return { name: 'Supabase', status: 'error', message: `Supabase returned HTTP ${res.status}` }
  } catch (err) {
    return { name: 'Supabase', status: 'error', message: `Cannot reach Supabase: ${String(err)}` }
  }
}

async function checkVapi(): Promise<CheckResult> {
  try {
    const apiKey = await getSecret('vapi_api_key')
    if (!apiKey) return { name: 'VAPI', status: 'warning', message: 'VAPI key not configured' }

    const res = await fetch('https://api.vapi.ai/call?limit=1', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (res.ok) return { name: 'VAPI', status: 'ok', message: 'VAPI connection healthy' }
    return { name: 'VAPI', status: 'error', message: `VAPI returned HTTP ${res.status}` }
  } catch (err) {
    return { name: 'VAPI', status: 'error', message: `Cannot reach VAPI: ${String(err)}` }
  }
}

async function checkAiProvider(settings: { ai_provider: string; ollama_url: string; ollama_briefing_model?: string }): Promise<CheckResult> {
  if (settings.ai_provider === 'ollama') {
    try {
      const res = await fetch(`${settings.ollama_url}/api/tags`)
      if (res.ok) return { name: 'Ollama', status: 'ok', message: 'Ollama running locally' }
      return { name: 'Ollama', status: 'error', message: `Ollama returned HTTP ${res.status}` }
    } catch {
      return { name: 'Ollama', status: 'error', message: `Cannot reach Ollama at ${settings.ollama_url}` }
    }
  } else {
    const apiKey = await getSecret('claude_api_key')
    if (!apiKey) return { name: 'Claude API', status: 'warning', message: 'Claude API key not configured' }
    return { name: 'Claude API', status: 'ok', message: 'Claude API key present' }
  }
}

function checkSyncQueue(): CheckResult {
  try {
    const db = getDb()
    const backlog = (db.prepare('SELECT COUNT(*) as n FROM sync_queue').get() as { n: number }).n
    if (backlog === 0) return { name: 'Sync Queue', status: 'ok', message: 'All data synced to cloud' }
    if (backlog < 50) return { name: 'Sync Queue', status: 'warning', message: `${backlog} items pending sync` }
    return { name: 'Sync Queue', status: 'error', message: `${backlog} items stuck in sync queue` }
  } catch (err) {
    return { name: 'Sync Queue', status: 'error', message: String(err) }
  }
}

// ── AI Briefing ────────────────────────────────────────────────────────────

async function generateBriefing(
  settings: { ai_provider: string; ollama_url: string; ollama_briefing_model?: string },
  errors: CheckResult[]
): Promise<string> {
  const db = getDb()
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  const callsYesterday = (db.prepare(
    `SELECT COUNT(*) as n FROM calls WHERE started_at >= ? AND started_at < ?`
  ).get(yesterday, today) as { n: number }).n

  const totalCustomers = (db.prepare('SELECT COUNT(*) as n FROM customers').get() as { n: number }).n

  const missedCalls = (db.prepare(
    `SELECT COUNT(*) as n FROM calls WHERE status = 'missed' AND started_at >= ?`
  ).get(yesterday) as { n: number }).n

  const recentCalls = db.prepare(
    `SELECT customer_name, status, summary FROM calls ORDER BY started_at DESC LIMIT 3`
  ).all() as Array<{ customer_name: string; status: string; summary: string }>

  const errorSummary = errors.length > 0
    ? `\nSYSTEM ISSUES DETECTED:\n${errors.map(e => `- ${e.name}: ${e.message}`).join('\n')}`
    : ''

  const prompt = `You are the daily overseer for a heating/HVAC repair business CRM.
Generate a concise morning briefing (max 5 bullet points). Write in English.

CRM Data:
- Calls yesterday: ${callsYesterday} (missed: ${missedCalls})
- Total customers: ${totalCustomers}
- Recent calls: ${JSON.stringify(recentCalls)}
${errorSummary}

Rules:
- If there are system issues, mention them first as action items
- Otherwise cover: yesterday's performance, anything that needs follow-up, one tip for today
- Be concise and professional`

  try {
    if (settings.ai_provider === 'ollama') {
      const model = settings.ollama_briefing_model
      if (!model) return 'No briefing model configured — set a Briefing Model in Settings → AI.'
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 120_000)
      const res = await fetch(`${settings.ollama_url}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, stream: false }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout))
      if (!res.ok) return `Ollama error ${res.status} — is the briefing model downloaded?`
      const data = (await res.json()) as { response?: string; error?: string }
      if (data.error) return `Ollama: ${data.error}`
      // Strip deepseek-r1 <think>...</think> reasoning block
      const raw = data.response ?? 'No briefing generated.'
      return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    } else {
      const apiKey = await getSecret('claude_api_key')
      if (!apiKey) return 'Claude API key not configured — cannot generate briefing.'
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 600,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      const data = (await res.json()) as { content: Array<{ text: string }> }
      return data.content[0]?.text ?? 'No briefing generated.'
    }
  } catch (err) {
    return `Could not generate AI briefing: ${String(err)}`
  }
}

// ── Persist + notify ───────────────────────────────────────────────────────

function persistReport(report: OverseerReport) {
  const db = getDb()
  db.prepare(
    `INSERT INTO overseer_log (checked_at, status, checks, briefing, errors)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    report.checkedAt,
    report.status,
    JSON.stringify(report.checks),
    report.briefing,
    JSON.stringify(report.errors)
  )

  // Keep only last 90 days
  db.prepare(`DELETE FROM overseer_log WHERE checked_at < datetime('now', '-90 days')`).run()
}

function notifyUser(report: OverseerReport, win: BrowserWindow | null) {
  if (report.status === 'ok') {
    new Notification({
      title: '✅ Ergoflow — Daily Briefing Ready',
      body: 'All systems healthy. Click to view your morning briefing.',
    }).show()
  } else if (report.status === 'degraded') {
    const n = new Notification({
      title: '⚠️ Ergoflow — Warnings Detected',
      body: `${report.errors.length} issue(s) need attention. Click to view report.`,
      urgency: 'normal',
    })
    n.show()
    n.on('click', () => {
      win?.webContents.send('overseer:show')
      win?.focus()
    })
  } else {
    const n = new Notification({
      title: '🔴 Ergoflow — System Issues',
      body: report.errors.map(e => `${e.name}: ${e.message}`).join('\n'),
      urgency: 'critical',
    })
    n.show()
    n.on('click', () => {
      win?.webContents.send('overseer:show')
      win?.focus()
    })
  }
}
