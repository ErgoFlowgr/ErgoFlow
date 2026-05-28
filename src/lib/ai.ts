import { supabaseFetch } from './platform'
import { searchChunks, type Customer, type InventoryItem } from './db'

type BraveResult = { web?: { results?: Array<{ title: string; description: string; url: string }> } }

interface AIConfig {
  allowWebSearch?: boolean
  braveApiKey?: string
  imageModel?: string
  language?: string
}

// ── Embeddings ─────────────────────────────────────────────────────────────

export async function getEmbedding(text: string, _config: AIConfig): Promise<number[]> {
  return textToVector(text)
}

function textToVector(text: string): number[] {
  const vec = new Array(384).fill(0)
  for (let i = 0; i < text.length; i++) {
    vec[i % 384] += text.charCodeAt(i) / 1000
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / norm)
}

// ── Web Search ─────────────────────────────────────────────────────────────

async function webSearch(query: string, apiKey: string, lang?: string): Promise<string> {
  // On Electron: routed via IPC to avoid CORS. On mobile: direct fetch.
  const isElectron = typeof window !== 'undefined' && !!window.electron
  let data: BraveResult
  if (isElectron) {
    data = await window.electron!.braveSearch(query, apiKey, lang) as BraveResult
  } else {
    const params = new URLSearchParams({ q: query, count: '5' })
    if (lang) params.set('country', lang === 'el' ? 'GR' : 'US')
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': apiKey },
    })
    data = await res.json() as BraveResult
  }
  const results = data.web?.results ?? []
  if (results.length === 0) return 'No web results found.'
  return results.map((r, i) => `${i + 1}. ${r.title}\n${r.description}\nSource: ${r.url}`).join('\n\n')
}

// ── Claude API call ────────────────────────────────────────────────────────

async function callClaude(
  message: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  system: string,
  imageBase64?: string,
  imageMimeType?: string,
  imageModel?: string
): Promise<string> {
  const userContent = imageBase64
    ? [
        { type: 'image', source: { type: 'base64', media_type: imageMimeType ?? 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: message },
      ]
    : message

  const model = imageBase64 && imageModel ? imageModel : 'claude-sonnet-4-6'

  const res = await supabaseFetch('/functions/v1/claude-proxy', {
    method: 'POST',
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: [...history.slice(-10), { role: 'user', content: userContent }],
    }),
  })

  if (!res.ok) throw new Error(`Claude API error: ${await res.text()}`)
  const data = await res.json() as { content: Array<{ text: string }> }
  return data.content[0]?.text ?? ''
}

// ── Chat with RAG ──────────────────────────────────────────────────────────

export async function chatWithRAG(
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  config: AIConfig
): Promise<string> {
  const embedding = await getEmbedding(userMessage, config)
  const chunks = await searchChunks(embedding, 5)
  const context = chunks.map(c => c.content).join('\n\n---\n\n')

  const systemPrompt = context
    ? `You are a helpful assistant for a heating/HVAC repair technician.
Answer questions about products and repairs using the following product documentation:

${context}

If the answer is not in the documentation, say so clearly.`
    : `You are a helpful assistant for a heating/HVAC repair technician.
No product documents have been uploaded yet. Answer from general knowledge.`

  return callClaude(userMessage, history, systemPrompt)
}

// ── Chat with Actions (job creation / editing via AI) ──────────────────────

export interface AIAction {
  type: 'create_job' | 'update_job' | 'download_pdfs' | 'scrape_page' | 'create_offer' | 'add_inventory_item' | 'update_inventory_item' | 'create_customer'
  title?: string
  customer_name?: string
  customer_id?: string | null
  scheduled_date?: string
  description?: string
  priority?: 'low' | 'normal' | 'high'
  notes?: string
  job_id?: string
  status?: string
  query?: string
  urls?: Array<{ name: string; url: string }>
  scrape_url?: string
  offer_items?: Array<{ description: string; quantity: number; unit_price: number }>
  tax_rate?: number
  item_name?: string
  item_code?: string
  item_unit?: string
  item_price?: number
  item_notes?: string
  contact_name?: string
  contact_phone?: string
  contact_email?: string
  contact_company?: string
  contact_address?: string
}

export interface AIActionResult {
  text: string
  action?: AIAction
}

function parseAction(raw: string): AIActionResult {
  const match = raw.match(/<action>([\s\S]*?)<\/action>/i)
  if (match) {
    const text = raw.replace(/<action>[\s\S]*?<\/action>/i, '').trim()
    try {
      const action = JSON.parse(match[1]) as AIAction
      return { text, action }
    } catch {
      return { text }
    }
  }
  const codeBlockMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i)
  if (codeBlockMatch) {
    try {
      const action = JSON.parse(codeBlockMatch[1]) as AIAction
      if (action.type) {
        const text = raw.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/i, '').trim()
        return { text, action }
      }
    } catch { /* ignore */ }
  }
  return { text: raw.trim() }
}

export async function chatWithActions(
  userMessage: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  config: AIConfig,
  customers: Customer[],
  companyInfo?: { companyName?: string | null; ownerName?: string | null; ownerLastName?: string | null; phone?: string | null; address?: string | null },
  imageBase64?: string,
  imageMimeType?: string,
  inventory?: InventoryItem[]
): Promise<AIActionResult> {
  const embedding = await getEmbedding(userMessage, config)
  const chunks = await searchChunks(embedding, 3)
  const context = chunks.map(c => c.content).join('\n\n---\n\n')
  const today = new Date().toISOString().slice(0, 10)

  const customerList = customers.length > 0
    ? customers.map(c => `  - ${c.name} (id: ${c.id}${c.phone ? ', phone: ' + c.phone : ''})`).join('\n')
    : '  (no customers yet)'

  const pdfIntent = /pdf|manual|εγχειρίδιο|οδηγ|download|κατέβα/i.test(userMessage)

  let webResults = ''
  let pdfResults = ''
  if (config.allowWebSearch && config.braveApiKey) {
    try { webResults = await webSearch(userMessage, config.braveApiKey, config.language) } catch { /* ignore */ }
    if (pdfIntent) {
      try { pdfResults = await webSearch(userMessage + ' filetype:pdf', config.braveApiKey, config.language) } catch { /* ignore */ }
    }
  }

  const extractPdfUrls = (text: string) =>
    [...text.matchAll(/https?:\/\/[^\s)]+\.pdf/gi)].map(m => m[0])
  const foundPdfUrls = [...new Set([...extractPdfUrls(webResults), ...extractPdfUrls(pdfResults)])]

  const inventoryBlock = inventory && inventory.length > 0
    ? `\nPRICE CATALOG (IMPORTANT: use ONLY these exact prices when creating offers — do NOT guess or invent prices):\n` +
      inventory.map(i => `  - ${i.name}${i.code ? ' [' + i.code + ']' : ''}: ${i.price}€ / ${i.unit}`).join('\n') + '\n'
    : ''

  const ownerFullName = [companyInfo?.ownerName, companyInfo?.ownerLastName].filter(Boolean).join(' ')
  const companyBlock = companyInfo ? `
BUSINESS INFO (use this when generating offers/documents — never use placeholders):
  Company: ${companyInfo.companyName || '—'}
  Owner: ${ownerFullName || '—'}
  Phone: ${companyInfo.phone || '—'}
  Address: ${companyInfo.address || '—'}
` : ''

  const systemPrompt = `You are a CRM assistant for an HVAC/repair business. You can:
1. Answer questions about products and repairs${context ? ' using the documentation below' : ''}
2. Create and manage jobs in the CRM
3. Create offers/quotes for customers${config.allowWebSearch ? '\n4. Use web search results when provided to answer current/online questions' : ''}

LANGUAGE RULE: The app is set to ${config.language === 'en' ? 'English' : 'Greek (Ελληνικά)'}. Always respond in the same language the user writes in. If they write in Greek, reply in Greek (Ελληνικά). If they write in English, reply in English. Never switch languages unless explicitly asked to. NEVER translate or transliterate brand names, product names, model numbers, or codes — keep them exactly as written (e.g. "Samsung Wind-Free", "SAM-WF12", "Tesla 9000 BTU" stay in Latin characters always).

TODAY: ${today}
${companyBlock}
EXISTING CUSTOMERS:
${customerList}

${inventoryBlock}${context ? `PRODUCT DOCUMENTATION:\n${context}\n` : ''}${webResults ? `WEB SEARCH RESULTS:\n${webResults}\n` : ''}${foundPdfUrls.length > 0 ? `\nDIRECT PDF URLS FOUND (use ONLY these, never invent URLs):\n${foundPdfUrls.map((u, i) => `${i + 1}. ${u}`).join('\n')}\n` : ''}
IMPORTANT — When the user wants to create a job, schedule work, or book a visit:
- Match the customer name to an existing customer if possible (use their exact id)
- Extract the type of work as the job title
- Dates: interpret DD/MM/YYYY format, output as YYYY-MM-DD
- Respond conversationally AND include this block at the end of your reply:
<action>{"type":"create_job","title":"...","customer_name":"...","customer_id":"<uuid or null>","scheduled_date":"YYYY-MM-DD","description":"...","priority":"normal"}</action>

When the user asks to update or change an existing job, use:
<action>{"type":"update_job","job_id":"<uuid>","status":"..."}</action>

When the user asks to find, search for, or download PDF manuals/documents:
- ONLY use URLs from the "DIRECT PDF URLS FOUND" list above — NEVER invent or guess URLs
- If no PDF URLs are listed above, tell the user you could not find any direct PDF links and suggest they search manually
- If PDF URLs are available, respond conversationally AND include this block:
<action>{"type":"download_pdfs","query":"...","urls":[{"name":"filename.pdf","url":"https://..."},...]}</action>

When the user asks to scrape a webpage or find PDFs on a specific website URL:
- Respond conversationally AND include this block:
<action>{"type":"scrape_page","scrape_url":"https://..."}</action>

IMPORTANT — When the user wants to create an offer, quote, or προσφορά:
- Match the customer name to an existing customer if possible (use their exact id)
- Break down the work into line items (description, quantity, unit_price)
- For unit_price: ALWAYS use the exact price from the PRICE CATALOG above if the item matches. Only use 0 if genuinely unknown and not in the catalog.
- Default tax_rate is 24 (Greek VAT) unless specified otherwise
- DO NOT write a formal offer letter in the chat — just confirm briefly AND ALWAYS include this action block:
<action>{"type":"create_offer","customer_name":"...","customer_id":"<uuid or null>","offer_items":[{"description":"...","quantity":1,"unit_price":0}],"tax_rate":24}</action>

IMPORTANT — When the user wants to add a product, service, or item to the price catalog / τιμοκατάλογος:
- Extract: name (required), code (optional short SKU/code), unit (default "τεμ." for piece, "ώρα" for hour, "μήνας" for month), price, notes
- Just confirm briefly in the user's language (e.g. "Προστέθηκε!" or "Added!") — do NOT describe or explain the action block, do NOT say "Here's the action block", just append it silently:
<action>{"type":"add_inventory_item","item_name":"...","item_code":"...","item_unit":"τεμ.","item_price":0,"item_notes":"..."}</action>

IMPORTANT — When the user wants to update the price or details of an existing catalog item:
- Look up by code (preferred) or by name
- Just confirm briefly and append the action block silently:
<action>{"type":"update_inventory_item","item_code":"...","item_price":0}</action>
OR if no code: <action>{"type":"update_inventory_item","item_name":"...","item_price":0}</action>

IMPORTANT — When the user shares an image of a business card or contact:
- Extract all visible details (name, company, phone, email, address)
- Confirm briefly what you found AND append the action block silently:
<action>{"type":"create_customer","contact_name":"Full Name","contact_company":"Company","contact_phone":"+30...","contact_email":"...","contact_address":"..."}</action>
- Only include fields clearly visible in the image. contact_name is required; use company name if no personal name is visible.

IMPORTANT — When the user shares an image of a product, label, or box and wants to add it to the catalog:
- Extract: product name/model, any code/SKU, category — respond briefly AND append the action block silently:
<action>{"type":"add_inventory_item","item_name":"...","item_code":"...","item_unit":"τεμ.","item_price":0,"item_notes":"..."}</action>
- Set item_price to 0 if price is not visible — the user can update it later.

Only include ONE <action> block per response. Never include it for questions or general chat. NEVER say "Here's the action block" or describe the block — just include it.`

  const raw = await callClaude(userMessage, history, systemPrompt, imageBase64, imageMimeType, config.imageModel)
  return parseAction(raw)
}

// ── Translate job fields ───────────────────────────────────────────────────

export async function translateJobFields(
  fields: { title: string; description: string; notes: string },
  targetLanguage: string,
  _config: AIConfig
): Promise<{ title: string; description: string; notes: string }> {
  const langName = targetLanguage === 'el' ? 'Greek' : 'English'
  const prompt = `Translate the following job fields to ${langName}. Return ONLY valid JSON with keys "title", "description", "notes". Do not add explanations.

title: ${fields.title}
description: ${fields.description}
notes: ${fields.notes}`

  const raw = await callClaude(prompt, [], 'You are a translator. Return only valid JSON.')
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('Invalid translation response')
  return JSON.parse(jsonMatch[0]) as { title: string; description: string; notes: string }
}

// ── Build config from stored settings ─────────────────────────────────────

export async function getAIConfig(
  _settingsClaudeKey?: string | null,
  allowWebSearch?: boolean,
  braveApiKey?: string | null,
  imageModel?: string | null,
  language?: string
): Promise<AIConfig> {
  return {
    allowWebSearch: allowWebSearch ?? false,
    braveApiKey: braveApiKey ?? undefined,
    imageModel: imageModel ?? 'claude-sonnet-4-6',
    language: language ?? 'el',
  }
}
