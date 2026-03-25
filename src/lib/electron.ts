// Type-safe wrapper around the contextBridge API exposed in preload.ts

interface ElectronAPI {
  keychain: {
    set:    (key: string, value: string) => Promise<void>
    get:    (key: string) => Promise<string | null>
    delete: (key: string) => Promise<void>
  }
  db: {
    query: (sql: string, params?: unknown[]) => Promise<unknown[]>
    run:   (sql: string, params?: unknown[]) => Promise<{ changes: number; lastInsertRowid: number }>
    get:   (sql: string, params?: unknown[]) => Promise<unknown | undefined>
  }
  printInvoice: (html: string) => Promise<void>
  downloadPdf:  (url: string) => Promise<ArrayBuffer>
  braveSearch:  (query: string, apiKey: string) => Promise<unknown>
  fetchHtml:    (url: string) => Promise<string>
  notify:       (title: string, body: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  getVersion:   () => Promise<string>
  getDataPath:  () => Promise<string>
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
