import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getChatHistory, getDocuments, getSettings, getCustomers, insertChatMessage, updateChatMessage, upsertJob, upsertOffer, getNextOfferNumber, upsertInventoryItem, getInventory, uuid, type ChatMessage, type Document, type Customer } from '../../lib/db'
import { chatWithActions, getAIConfig, type AIAction } from '../../lib/ai'
import { processPDF } from '../../lib/pdf'
import { ipc } from '../../lib/electron'

// Extend Window for SpeechRecognition (Chromium/Electron)
declare global {
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
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [actionCards, setActionCards] = useState<ActionCard[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [listening, setListening] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
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
        const settings = await getSettings()
        let done = 0
        for (const { name, url } of action.urls) {
          setActionCards(prev => prev.map(c => c.msgId === msgId
            ? { ...c, status: 'pending', result: `⬇️ Downloading ${done + 1}/${action.urls!.length}: ${name}` }
            : c))
          const buffer = await ipc.downloadPdf(url)
          const file = new File([buffer], name, { type: 'application/pdf' })
          await processPDF(file, settings.ai_provider, settings.ollama_url)
          done++
        }
        setDocuments(await getDocuments())
        await completeAction(msgId, `Downloaded ${done} PDF${done !== 1 ? 's' : ''}`)

      } else if (action.type === 'scrape_page' && action.scrape_url) {
        const settings = await getSettings()
        const baseUrl = new URL(action.scrape_url).origin

        setActionCards(prev => prev.map(c => c.msgId === msgId ? { ...c, status: 'pending', result: `🔍 Scanning page...` } : c))

        // Fetch the listing page
        const html = await ipc.fetchHtml(action.scrape_url)

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
              const subHtml = await ipc.fetchHtml(link)
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
            const buffer = await ipc.downloadPdf(pdfUrl)
            const file = new File([buffer], name, { type: 'application/pdf' })
            await processPDF(file, settings.ai_provider, settings.ollama_url)
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

  const sendText = async (text: string) => {
    if (!text || thinking) return

    const userMsg: ChatMessage = { id: uuid(), role: 'user', content: text, created_at: new Date().toISOString() }
    setMessages(p => [...p, userMsg])
    await insertChatMessage({ id: userMsg.id, role: 'user', content: text })

    setThinking(true)
    try {
      const settings = await getSettings()
      const config = await getAIConfig(settings.ai_provider, settings.ollama_url, settings.ollama_chat_model, settings.ollama_embed_model, settings.claude_api_key, !!settings.allow_web_search, settings.brave_search_key)
      const history = messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
      const { text: reply, action, usedCloudFallback } = await chatWithActions(text, history, config, customers, {
        companyName: settings.company_name,
        ownerName: settings.owner_name,
        ownerLastName: settings.owner_last_name,
        phone: settings.phone,
        address: settings.address,
      })

      const assistantId = uuid()
      const fullReply = usedCloudFallback
        ? `⚠️ *Ollama offline — using Cloud AI*\n\n${reply}`
        : reply
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
    await sendText(text)
  }

  const uploadPDF = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const settings = await getSettings()
      await processPDF(file, settings.ai_provider, settings.ollama_url)
      setDocuments(await getDocuments())
    } catch (err) {
      alert(`PDF error: ${String(err)}`)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
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

  return (
    <div className="flex h-full">
      {/* Sidebar: documents */}
      <div className="w-64 border-r border-surface-600 bg-surface-800 flex flex-col">
        <div className="p-4 border-b border-surface-600">
          <h2 className="font-semibold text-sm text-gray-300 uppercase tracking-wider mb-3">PDFs</h2>
          <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={uploadPDF} />
          <button
            className="btn-primary w-full justify-center text-sm"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <span className="flex items-center gap-2">
                <span className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />
                Uploading...
              </span>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {t('chat.upload')}
              </>
            )}
          </button>
        </div>

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
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col">
        <div className="p-4 border-b border-surface-600">
          <h1 className="text-xl font-bold">{t('chat.title')}</h1>
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
        <div className="p-4 border-t border-surface-600">
          <div className="flex gap-3">
            <input
              className="input flex-1"
              placeholder={t('chat.placeholder')}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
              disabled={thinking}
            />
            {/* Microphone button */}
            <button
              className={`px-3 rounded-lg border transition-colors ${
                listening
                  ? 'bg-red-500/20 border-red-500/50 text-red-400 animate-pulse'
                  : 'border-surface-600 text-gray-400 hover:text-white hover:bg-surface-700'
              }`}
              onClick={toggleVoice}
              disabled={thinking}
              title={listening ? 'Stop listening' : 'Voice input'}
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
        </div>
      </div>
    </div>
  )
}
