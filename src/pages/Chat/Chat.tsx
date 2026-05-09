import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getChatHistory, clearChatHistory, getDocuments, getSettings, getCustomers, insertChatMessage, updateChatMessage, upsertJob, upsertOffer, upsertCustomer, getNextOfferNumber, upsertInventoryItem, getInventory, uuid, type ChatMessage, type Document, type Customer } from '../../lib/db'
import { chatWithActions, getAIConfig, type AIAction } from '../../lib/ai'
import { processPDF } from '../../lib/pdf'
import { platform } from '../../lib/platform'
import { activateAITrial } from '../../lib/license'
import { useSubscription } from '../../App'
import { isElectron, ipc } from '../../lib/electron'

// Extend Window for SpeechRecognition (Chromium/Electron)
declare global {
  interface SpeechRecognition extends EventTarget {
    continuous: boolean
    interimResults: boolean
    lang: string
    maxAlternatives: number
    onresult: ((event: SpeechRecognitionEvent) => void) | null
    onerror: ((event: Event) => void) | null
    onend: (() => void) | null
    start(): void
    stop(): void
    abort(): void
  }
  interface SpeechRecognitionEvent extends Event {
    readonly results: SpeechRecognitionResultList
  }
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition
    webkitSpeechRecognition?: new () => SpeechRecognition
  }
}

interface ActionCard {
  msgId: string
  action: AIAction
  status: 'pending' | 'done' | 'error'
  result?: string
}

export default function Chat() {
  const { t, i18n } = useTranslation()
  const { canUseAI, aiTrialUsed, refreshSubscription, requestUpgrade } = useSubscription()
  const [trialActivating, setTrialActivating] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [actionCards, setActionCards] = useState<ActionCard[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvImportResult, setCsvImportResult] = useState<string | null>(null)
  const [listening, setListening] = useState(false)
  const [imageBase64, setImageBase64] = useState<string | null>(null)
  const [imageMimeType, setImageMimeType] = useState<string>('image/jpeg')
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [showCamera, setShowCamera] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const csvRef  = useRef<HTMLInputElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recognitionRef = useRef<SpeechRecognition | null>(null)

  useEffect(() => {
    getChatHistory().then(setMessages)
    getDocuments().then(setDocuments)
    getCustomers().then(setCustomers)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Marks action as done AND appends result to the stored message so it persists on tab switch
  const completeAction = async (msgId: string, result: string) => {
    setActionCards(prev => prev.map(c => c.msgId === msgId ? { ...c, status: 'done', result } : c))
    setMessages(prev => {
      const updated = prev.map(m => m.id === msgId ? { ...m, content: m.content + `\n\n✅ ${result}` } : m)
      const msg = updated.find(m => m.id === msgId)
      if (msg) updateChatMessage(msgId, msg.content)
      return updated
    })
  }

  const executeAction = async (action: AIAction, msgId: string) => {
    try {
      if (action.type === 'create_offer' && action.offer_items?.length) {
        const num = await getNextOfferNumber()
        const items = action.offer_items.map(it => ({
          id: uuid(),
          description: it.description,
          quantity: it.quantity,
          unit_price: it.unit_price,
          total: it.quantity * it.unit_price,
          sort_order: 0,
        }))
        // Look up customer address from the loaded customers list
        const matchedCustomer = customers.find(c =>
          (action.customer_id && c.id === action.customer_id) ||
          (action.customer_name && c.name.toLowerCase() === action.customer_name.toLowerCase())
        )
        const customerAddress = matchedCustomer
          ? [matchedCustomer.address, matchedCustomer.postal_code, matchedCustomer.city].filter(Boolean).join(', ')
          : null
        await upsertOffer({
          number: num,
          customer_id: action.customer_id ?? matchedCustomer?.id ?? null,
          customer_name: action.customer_name ?? null,
          customer_address: customerAddress,
          status: 'pending',
          issue_date: new Date().toISOString().slice(0, 10),
          tax_rate: action.tax_rate ?? 24,
          notes: `Includes VAT at ${action.tax_rate ?? 24}% / Συμπεριλαμβάνεται ΦΠΑ ${action.tax_rate ?? 24}%`,
        }, items)
        const total = items.reduce((s, it) => s + it.total, 0)
        await completeAction(msgId, `Offer ${num} created for ${action.customer_name ?? '—'} · ${total.toFixed(2)} €`)

      } else if (action.type === 'add_inventory_item' && action.item_name) {
        await upsertInventoryItem({
          name: action.item_name,
          code: action.item_code ?? null,
          unit: action.item_unit ?? 'τεμ.',
          price: action.item_price ?? 0,
          notes: action.item_notes ?? null,
        })
        await completeAction(msgId, `"${action.item_name}" added to Price Catalog · ${(action.item_price ?? 0).toFixed(2)} €`)

      } else if (action.type === 'update_inventory_item' && (action.item_code || action.item_name)) {
        const searchTerm = action.item_code ?? action.item_name!
        const matches = await getInventory(searchTerm)
        const found = matches.find(i => i.code?.toLowerCase() === action.item_code?.toLowerCase())
          ?? matches.find(i => i.name.toLowerCase() === action.item_name?.toLowerCase())
          ?? (matches.length === 1 ? matches[0] : null)
        if (!found) {
          await completeAction(msgId, `⚠️ No item found for "${searchTerm}"`)
        } else {
          await upsertInventoryItem({
            id: found.id,
            name: action.item_name ?? found.name,
            code: found.code,
            unit: action.item_unit ?? found.unit,
            price: action.item_price ?? found.price,
            notes: action.item_notes ?? found.notes,
          })
          await completeAction(msgId, `"${found.name}" updated · ${(action.item_price ?? found.price).toFixed(2)} €`)
        }

      } else if (action.type === 'create_customer' && action.contact_name) {
        await upsertCustomer({
          name: action.contact_name,
          company_name: action.contact_company ?? null,
          phone: action.contact_phone ?? null,
          email: action.contact_email ?? null,
          address: action.contact_address ?? null,
        })
        setCustomers(await getCustomers())
        await completeAction(msgId, `Contact "${action.contact_name}" added`)

      } else if (action.type === 'create_job' && action.title) {
        await upsertJob({
          title: action.title,
          customer_id: action.customer_id ?? null,
          customer_name: action.customer_name ?? null,
          scheduled_date: action.scheduled_date ?? null,
          description: action.description ?? null,
          priority: action.priority ?? 'normal',
          notes: action.notes ?? null,
          status: 'pending',
        })
        setCustomers(await getCustomers())
        await completeAction(msgId, `Job "${action.title}" created`)

      } else if (action.type === 'download_pdfs' && action.urls?.length) {
        let done = 0
        for (const { name, url } of action.urls) {
          setActionCards(prev => prev.map(c => c.msgId === msgId
            ? { ...c, status: 'pending', result: `⬇️ Downloading ${done + 1}/${action.urls!.length}: ${name}` }
            : c))
          const buffer = window.electron
            ? await window.electron.downloadPdf(url)
            : await fetch(url).then(r => r.arrayBuffer())
          const file = new File([buffer], name, { type: 'application/pdf' })
          await processPDF(file)
          done++
        }
        setDocuments(await getDocuments())
        await completeAction(msgId, `Downloaded ${done} PDF${done !== 1 ? 's' : ''}`)

      } else if (action.type === 'scrape_page' && action.scrape_url) {
        const baseUrl = new URL(action.scrape_url).origin

        setActionCards(prev => prev.map(c => c.msgId === msgId ? { ...c, status: 'pending', result: `🔍 Scanning page...` } : c))

        const fetchHtml = (url: string) => window.electron
          ? window.electron.fetchHtml(url)
          : fetch(url).then(r => r.text())

        // Fetch the listing page
        const html = await fetchHtml(action.scrape_url)

        // Extract all .pdf links
        const pdfLinks = [...html.matchAll(/href=["']([^"']*\.pdf[^"']*)/gi)].map(m => {
          const href = m[1]
          return href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`
        })

        // Extract subpage links that might contain PDFs (same domain)
        const subLinks = [...new Set(
          [...html.matchAll(/href=["']([^"'#?]*)/gi)]
            .map(m => m[1])
            .filter(h => h.startsWith('/') && !h.endsWith('.css') && !h.endsWith('.js'))
            .slice(0, 20)
            .map(h => `${baseUrl}${h}`)
        )]

        let allPdfLinks = [...new Set(pdfLinks)]

        // If no direct PDFs found, check subpages
        if (allPdfLinks.length === 0 && subLinks.length > 0) {
          setActionCards(prev => prev.map(c => c.msgId === msgId ? { ...c, status: 'pending', result: `🔍 Checking ${subLinks.length} subpages...` } : c))
          for (const link of subLinks) {
            try {
              const subHtml = await fetchHtml(link)
              const subPdfs = [...subHtml.matchAll(/href=["']([^"']*\.pdf[^"']*)/gi)].map(m => {
                const href = m[1]
                return href.startsWith('http') ? href : `${baseUrl}${href.startsWith('/') ? '' : '/'}${href}`
              })
              allPdfLinks = [...new Set([...allPdfLinks, ...subPdfs])]
            } catch { /* skip unreachable pages */ }
          }
        }

        if (allPdfLinks.length === 0) {
          await completeAction(msgId, `⚠️ No direct PDF links found on this page`)
          return
        }

        let done = 0
        for (const pdfUrl of allPdfLinks) {
          const name = pdfUrl.split('/').pop() ?? `document-${done + 1}.pdf`
          setActionCards(prev => prev.map(c => c.msgId === msgId
            ? { ...c, status: 'pending', result: `⬇️ Downloading ${done + 1}/${allPdfLinks.length}: ${name}` }
            : c))
          try {
            const buffer = window.electron
              ? await window.electron.downloadPdf(pdfUrl)
              : await fetch(pdfUrl).then(r => r.arrayBuffer())
            const file = new File([buffer], name, { type: 'application/pdf' })
            await processPDF(file)
            done++
          } catch { /* skip failed downloads */ }
        }
        setDocuments(await getDocuments())
        await completeAction(msgId, `Found and downloaded ${done} PDF${done !== 1 ? 's' : ''}`)
      }
    } catch (err) {
      setActionCards(prev => prev.map(c => c.msgId === msgId ? { ...c, status: 'error', result: `Error: ${String(err)}` } : c))
    }
  }

  const sendText = async (text: string, imgBase64?: string, imgMime?: string) => {
    if (!text || thinking) return

    const userMsg: ChatMessage = { id: uuid(), role: 'user', content: text, created_at: new Date().toISOString() }
    setMessages(p => [...p, userMsg])
    await insertChatMessage({ id: userMsg.id, role: 'user', content: text })

    setThinking(true)
    try {
      const settings = await getSettings()
      const config = await getAIConfig(settings.claude_api_key, !!settings.allow_web_search, settings.brave_search_key, settings.image_model, i18n.language)
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      const inventoryItems = await getInventory()
      const { text: reply, action } = await chatWithActions(text, history, config, customers, {
        companyName: settings.company_name,
        ownerName: settings.owner_name,
        ownerLastName: settings.owner_last_name,
        phone: settings.phone,
        address: settings.address,
      }, imgBase64, imgMime, inventoryItems)

      const assistantId = uuid()
      const fullReply = reply
      const assistantMsg: ChatMessage = { id: assistantId, role: 'assistant', content: fullReply, created_at: new Date().toISOString() }
      setMessages(p => [...p, assistantMsg])
      await insertChatMessage({ id: assistantMsg.id, role: 'assistant', content: fullReply })

      if (action) {
        const card: ActionCard = { msgId: assistantId, action, status: 'pending' }
        setActionCards(prev => [...prev, card])
        setTimeout(() => executeAction(action, assistantId), 500)
      }
    } catch (err) {
      const errMsg: ChatMessage = { id: uuid(), role: 'assistant', content: `Error: ${String(err)}`, created_at: new Date().toISOString() }
      setMessages(p => [...p, errMsg])
    } finally {
      setThinking(false)
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    const img = imageBase64 ?? undefined
    const mime = imageMimeType
    setImageBase64(null)
    setImagePreview(null)
    await sendText(text, img, mime)
  }

  const pickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const base64 = dataUrl.split(',')[1]
      setImageBase64(base64)
      setImageMimeType(file.type || 'image/jpeg')
      setImagePreview(dataUrl)
    }
    reader.readAsDataURL(file)
    if (imageRef.current) imageRef.current.value = ''
  }

  const openCamera = async () => {
    setShowCamera(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
    } catch {
      alert('Could not access camera. Please allow camera permissions.')
      setShowCamera(false)
    }
  }

  const closeCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setShowCamera(false)
  }

  const capturePhoto = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')!.drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92)
    setImageBase64(dataUrl.split(',')[1])
    setImageMimeType('image/jpeg')
    setImagePreview(dataUrl)
    closeCamera()
  }

  const uploadPDF = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await processPDF(file)
      setDocuments(await getDocuments())
    } catch (err) {
      alert(`PDF error: ${String(err)}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const importContactsCsv = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCsvImporting(true)
    setCsvImportResult(null)
    try {
      // Strip BOM and normalize line endings
      let text = await file.text()
      text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

      // Detect delimiter
      const firstLine = text.split('\n')[0]
      const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ','

      const lines = text.split('\n').filter(l => l.trim())
      if (lines.length < 2) { setCsvImportResult('Δεν βρέθηκαν επαφές.'); return }

      const parseLine = (line: string) => {
        const fields: string[] = []; let cur = '', inQ = false
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '"') inQ = !inQ
          else if (line[i] === delim && !inQ) { fields.push(cur.trim()); cur = '' }
          else cur += line[i]
        }
        fields.push(cur.trim()); return fields
      }

      const rawHeaders = parseLine(lines[0])
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zα-ω0-9]/g, '')
      const headers = rawHeaders.map(norm)

      const mapField = (h: string): string | null => {
        if (/name|fullname|displayname|ονοματ|πελατ/.test(h)) return 'name'
        if (/firstname|first/.test(h)) return 'first_name'
        if (/lastname|last|επωνυμ/.test(h)) return 'last_name'
        if (/company|εταιρ/.test(h)) return 'company_name'
        if (/^(phone|telephone|τηλεφ|τηλ)$/.test(h)) return 'phone'
        if (/mobile|cell|κινητ/.test(h)) return 'mobile'
        if (/email|mail/.test(h)) return 'email'
        if (/address|διευθ/.test(h)) return 'address'
        if (/^city$|πολ/.test(h)) return 'city'
        if (/postal|zip|^τκ$/.test(h)) return 'postal_code'
        if (/^vat$|^afm$|^αφμ$/.test(h)) return 'vat_number'
        if (/notes|σημειω/.test(h)) return 'notes'
        return null
      }

      const mappings = headers.map(mapField)
      let count = 0

      for (const line of lines.slice(1)) {
        if (!line.trim()) continue
        const vals = parseLine(line)
        const row: Record<string, string> = {}
        mappings.forEach((f, i) => { if (f && vals[i]?.trim()) row[f] = vals[i].trim() })
        const name = row.name ||
          [row.first_name, row.last_name].filter(Boolean).join(' ') ||
          row.company_name || row.phone || row.mobile || row.email
        if (!name) continue
        await upsertCustomer({ id: uuid(), name, ...row } as Customer)
        count++
      }

      setCsvImportResult(count > 0 ? `✓ ${count} επαφές εισήχθησαν` : `Δεν αναγνωρίστηκαν στήλες. Κεφαλίδες: ${rawHeaders.join(', ')}`)
    } catch (err) {
      setCsvImportResult(`Σφάλμα: ${String(err)}`)
    } finally {
      setCsvImporting(false)
      if (csvRef.current) csvRef.current.value = ''
    }
  }

  const toggleVoice = () => {
    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition
    if (!SR) { alert('Speech recognition is not supported in this environment'); return }

    if (listening) {
      recognitionRef.current?.stop()
      return
    }

    const r = new SR()
    r.lang = i18n.language === 'el' ? 'el-GR' : 'en-US'
    r.interimResults = false
    r.maxAlternatives = 1

    r.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript
      setInput(transcript)
      setTimeout(() => sendText(transcript), 50)
    }

    r.onerror = () => setListening(false)
    r.onend = () => setListening(false)

    r.start()
    recognitionRef.current = r
    setListening(true)
  }

  const isMobile = platform.isMobile

  const handleActivateTrial = async () => {
    setTrialActivating(true)
    try {
      await activateAITrial()
      await refreshSubscription()
    } finally {
      setTrialActivating(false)
    }
  }

  const openPricing = () => { requestUpgrade() }

  // AI access gating
  if (!canUseAI) {
    if (!aiTrialUsed) {
      // Trial not yet activated — show activation screen
      return (
        <div className="flex h-full items-center justify-center p-6">
          <div className="bg-surface-800 border border-surface-600 rounded-2xl p-8 max-w-md w-full text-center space-y-5">
            <div className="flex justify-center">
              <div className="w-16 h-16 rounded-2xl bg-brand-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-brand-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.798-1.442 2.798H4.24c-1.47 0-2.441-1.798-1.442-2.798L4.2 15.3" />
                </svg>
              </div>
            </div>
            <div>
              <h2 className="text-xl font-bold text-white mb-2">Δοκιμάστε τον AI βοηθό δωρεάν</h2>
              <p className="text-sm text-gray-400 leading-relaxed">
                Ο AI βοηθός γνωρίζει την επιχείρησή σας — πελάτες, εργασίες, τιμολόγια. 14 ημέρες δωρεάν, χωρίς δέσμευση.
              </p>
            </div>
            <button
              className="btn-primary w-full justify-center py-3"
              onClick={handleActivateTrial}
              disabled={trialActivating}
            >
              {trialActivating ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Ενεργοποίηση...
                </span>
              ) : (
                'Έναρξη δωρεάν δοκιμής 14 ημερών'
              )}
            </button>
          </div>
        </div>
      )
    }

    // Trial used and expired — show upgrade screen
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="bg-surface-800 border border-surface-600 rounded-2xl p-8 max-w-md w-full text-center space-y-5">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-700 flex items-center justify-center">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1 1 .03 2.798-1.442 2.798H4.24c-1.47 0-2.441-1.798-1.442-2.798L4.2 15.3" />
              </svg>
            </div>
          </div>
          <div>
            <h2 className="text-xl font-bold text-white mb-2">Η δοκιμή σας έληξε</h2>
            <p className="text-sm text-gray-400 leading-relaxed">
              Αναβαθμίστε στο Plus για €39/μήνα για μόνιμη πρόσβαση στον AI βοηθό.
            </p>
          </div>
          <button
            className="btn-primary w-full justify-center py-3"
            onClick={openPricing}
          >
            Αναβάθμιση σε Plus
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex h-full ${isMobile ? 'flex-col' : ''}`}>
      {/* Sidebar / top bar */}
      <div className={isMobile
        ? 'border-b border-surface-600 bg-surface-800 p-3'
        : 'w-64 border-r border-surface-600 bg-surface-800 flex flex-col'
      }>
        <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={uploadPDF} />
        <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={importContactsCsv} />

        {/* Action buttons */}
        <div className={isMobile ? 'flex gap-2' : 'p-4 border-b border-surface-600'}>
          {!isMobile && <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider mb-3">PDFs</h2>}
          <button
            className={isMobile ? 'btn-primary flex-1 justify-center text-xs py-2' : 'btn-primary w-full justify-center text-sm mb-2'}
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                {!isMobile && 'Uploading...'}
              </span>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {isMobile ? 'PDF' : t('chat.upload')}
              </>
            )}
          </button>
          <button
            className={isMobile
              ? 'flex-1 flex items-center justify-center gap-1.5 py-2 bg-surface-700 text-gray-300 text-xs font-medium rounded-lg'
              : 'w-full flex items-center justify-center gap-2 px-3 py-2 bg-surface-700 hover:bg-surface-600 text-gray-300 text-xs font-medium rounded-lg transition-colors'
            }
            onClick={() => { setCsvImportResult(null); csvRef.current?.click() }}
            disabled={csvImporting}
          >
            {csvImporting ? (
              <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {isMobile ? 'CSV' : 'Εισαγωγή Επαφών CSV'}
              </>
            )}
          </button>
          {csvImportResult && !isMobile && (
            <p className={`text-xs mt-2 text-center ${csvImportResult.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
              {csvImportResult}
            </p>
          )}
        </div>
        {csvImportResult && isMobile && (
          <p className={`text-xs mt-2 text-center ${csvImportResult.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
            {csvImportResult}
          </p>
        )}

        {/* Document list — desktop only */}
        {!isMobile && (
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {documents.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 text-xs">{t('chat.noDocuments')}</p>
                <p className="text-gray-600 text-xs mt-1">{t('chat.noDocumentsSub')}</p>
              </div>
            ) : (
              documents.map(doc => (
                <div key={doc.id} className="bg-surface-700 rounded-lg p-2.5">
                  <p className="text-xs font-medium truncate">{doc.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{doc.page_count ?? '?'} pages</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="p-4 border-b border-surface-600 flex items-center justify-between">
          <h1 className="text-xl font-bold">{t('chat.title')}</h1>
          {messages.length > 0 && (
            <button
              className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${confirmClear ? 'bg-red-500 text-white' : 'text-gray-500 hover:text-red-400 hover:bg-red-500/10'}`}
              onClick={async () => {
                if (!confirmClear) { setConfirmClear(true); return }
                await clearChatHistory()
                setMessages([])
                setActionCards([])
                setConfirmClear(false)
              }}
              onBlur={() => setConfirmClear(false)}
            >
              {confirmClear ? t('chat.clearConfirm') : t('chat.clearHistory')}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center opacity-50">
              <svg className="w-12 h-12 text-gray-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <p className="text-gray-400">{t('chat.placeholder')}</p>
            </div>
          )}

          {messages.map(msg => {
            const card = actionCards.find(c => c.msgId === msg.id)
            return (
              <div key={msg.id}>
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-2xl rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-brand-500 text-white rounded-br-sm'
                      : 'bg-surface-700 text-gray-200 rounded-bl-sm'
                  }`}>
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                    <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-brand-100/70' : 'text-gray-500'}`}>
                      {new Date(msg.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
                {card && (
                  <div className="flex justify-start mt-2">
                    <div className={`max-w-sm rounded-xl px-4 py-3 text-xs border ${
                      card.status === 'done'  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' :
                      card.status === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-300' :
                      'bg-surface-700 border-surface-600 text-gray-400'
                    }`}>
                      {card.status === 'pending' && (
                        <span className="flex items-center gap-2">
                          <span className="w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
                          Creating job...
                        </span>
                      )}
                      {card.status !== 'pending' && card.result}
                      {card.status === 'done' && card.action.scheduled_date && (
                        <span className="block mt-0.5 text-emerald-400/70">
                          📅 {card.action.scheduled_date}
                          {card.action.customer_name && ` · ${card.action.customer_name}`}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {thinking && (
            <div className="flex justify-start">
              <div className="bg-surface-700 rounded-2xl rounded-bl-sm px-4 py-3">
                <span className="flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-surface-600">
          {imagePreview && (
            <div className="mb-3 flex items-start gap-2">
              <img src={imagePreview} alt="preview" className="h-20 rounded-lg object-cover border border-surface-500" />
              <button
                className="text-gray-500 hover:text-white mt-1"
                onClick={() => { setImageBase64(null); setImagePreview(null) }}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
          <input ref={imageRef} type="file" accept="image/*" className="hidden" onChange={pickImage} />
          {isMobile ? (
            /* Mobile: input full-width on top, buttons below */
            <div className="space-y-2">
              <textarea
                className="input w-full resize-none"
                rows={1}
                placeholder={t('chat.placeholder')}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), send())}
                disabled={thinking}
                autoCorrect="on"
                autoCapitalize="sentences"
                autoComplete="off"
                spellCheck={true}
              />
              <div className="flex gap-2">
                <button
                  className={`p-2.5 rounded-lg border transition-colors ${imageBase64 ? 'bg-brand-500/20 border-brand-500/50 text-brand-400' : 'border-surface-600 text-gray-400'}`}
                  onClick={openCamera} disabled={thinking}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
                <button
                  className={`p-2.5 rounded-lg border transition-colors ${listening ? 'bg-red-500/20 border-red-500/50 text-red-400 animate-pulse' : 'border-surface-600 text-gray-400'}`}
                  onClick={toggleVoice} disabled={thinking}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                </button>
                <button className="btn-primary flex-1 justify-center" onClick={send} disabled={thinking || !input.trim()}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                  </svg>
                  Αποστολή
                </button>
              </div>
            </div>
          ) : (
            /* Desktop: all on one row */
            <div className="flex gap-3">
              <input
                className="input flex-1"
                placeholder={t('chat.placeholder')}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
                disabled={thinking}
              />
              <button
                className={`px-3 rounded-lg border transition-colors ${imageBase64 ? 'bg-brand-500/20 border-brand-500/50 text-brand-400' : 'border-surface-600 text-gray-400 hover:text-white hover:bg-surface-700'}`}
                onClick={openCamera} disabled={thinking}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
              <button
                className={`px-3 rounded-lg border transition-colors ${listening ? 'bg-red-500/20 border-red-500/50 text-red-400 animate-pulse' : 'border-surface-600 text-gray-400 hover:text-white hover:bg-surface-700'}`}
                onClick={toggleVoice} disabled={thinking}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                </svg>
              </button>
              <button className="btn-primary px-5" onClick={send} disabled={thinking || !input.trim()}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
      {/* Camera modal */}
      {showCamera && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
          <div className="bg-surface-800 rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{ width: 520 }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-surface-600">
              <span className="font-semibold text-sm">Take a Photo</span>
              <button className="text-gray-400 hover:text-white" onClick={closeCamera}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="relative bg-black">
              <video ref={videoRef} className="w-full" style={{ maxHeight: 360 }} autoPlay playsInline muted />
            </div>
            <div className="flex gap-3 p-4">
              <button className="btn-primary flex-1 justify-center gap-2" onClick={capturePhoto}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="4" strokeWidth={2} />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                </svg>
                Capture
              </button>
              <button
                className="px-4 py-2 rounded-lg border border-surface-600 text-gray-400 hover:text-white hover:bg-surface-700 text-sm"
                onClick={() => { closeCamera(); imageRef.current?.click() }}
              >
                Choose file instead
              </button>
            </div>
          </div>
          <canvas ref={canvasRef} className="hidden" />
        </div>
      )}
    </div>
  )
}
