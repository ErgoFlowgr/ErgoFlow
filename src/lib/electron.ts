// Type-safe wrapper around the contextBridge API exposed in preload.ts

interface ElectronAPI {
  keychain: {
    set:    (key: string, value: string) => Promise<void>
    get:    (key: string) => Promise<string | null>
    delete: (key: string) => Promise<void>
  }
  db: {
    query:  (sql: string, params?: unknown[]) => Promise<unknown[]>
    run:    (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number }>
    get:    (sql: string, params?: unknown[]) => Promise<unknown | undefined>
    switch: (userId: string) => Promise<void>
    bulkDeleteCustomers: (ids: string[]) => Promise<void>
  }
  syncNow:    () => Promise<boolean>
  syncEnable: () => Promise<boolean>
  printInvoice: (html: string) => Promise<void>
  savePdf:      (html: string, defaultName: string) => Promise<{ ok: boolean; filePath?: string }>
  sharePdf:        (html: string, defaultName: string) => Promise<void>
  saveDesktopPdf:  (html: string, filename: string)   => Promise<string>
  downloadPdf:  (url: string) => Promise<ArrayBuffer>
  braveSearch:  (query: string, apiKey: string, lang?: string) => Promise<unknown>
  fetchHtml:    (url: string) => Promise<string>
  mydataSubmit: (params: { invoice: any, lineItems: any[], companyVat: string, customerVat: string, mydataUserId?: string, mydataApiKey?: string, documentType?: string }) => Promise<{ success: boolean, mark?: string, error?: string }>
  ollama: {
    tags:       (baseUrl: string) => Promise<{ models?: Array<{ name: string }> }>
    chat:       (baseUrl: string, body: string) => Promise<{ message: { content: string } }>
    embeddings: (baseUrl: string, body: string) => Promise<{ embedding: number[] }>
  }
  notify:       (title: string, body: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  getVersion:   () => Promise<string>
  getDataPath:  () => Promise<string>
  subscriptionCheck: () => Promise<{ status: string; tier: string; vapiMinutesUsed: number; vapiPhoneNumber: string | null }>
  setMinimizeToTray: (value: boolean) => void
  update: {
    onReady: (cb: () => void) => void
    onError: (cb: (msg: string) => void) => void
    install:  () => Promise<void>
  }
  on:  (channel: string, cb: (...args: unknown[]) => void) => void
  off: (channel: string, cb: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    electron?: ElectronAPI
  }
}

export const ipc = window.electron!

// Convenience: detect if running in Electron
export const isElectron = typeof window !== 'undefined' && !!window.electron

// Returns Supabase URL + anon key.
// Prefers build-time env vars (baked into the app for end users).
// Falls back to keychain for developers who set them manually in Settings.
export async function getSupabaseConfig(): Promise<{ url: string; anonKey: string } | null> {
  const envUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

  if (envUrl && envKey) return { url: envUrl, anonKey: envKey }

  // Dev fallback: read from keychain
  if (isElectron) {
    const url = await ipc.keychain.get('supabase_url')
    const key = await ipc.keychain.get('supabase_anon_key')
    if (url && key) return { url, anonKey: key }
  }

  return null
}
