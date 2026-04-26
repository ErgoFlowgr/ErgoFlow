import { isElectron, ipc, getSupabaseConfig } from './electron'

export const platform = {
  isElectron,
  isMobile: false,

  async getToken(): Promise<string | null> {
    if (isElectron) return ipc.keychain.get('supabase_access_token')
    return localStorage.getItem('supabase_access_token')
  },

  async setToken(token: string): Promise<void> {
    if (isElectron) { await ipc.keychain.set('supabase_access_token', token); return }
    localStorage.setItem('supabase_access_token', token)
  },

  async clearToken(): Promise<void> {
    if (isElectron) { await ipc.keychain.delete('supabase_access_token'); return }
    localStorage.removeItem('supabase_access_token')
  },

  async getKeychainValue(key: string): Promise<string | null> {
    if (isElectron) return ipc.keychain.get(key)
    return localStorage.getItem(key)
  },

  async setKeychainValue(key: string, value: string): Promise<void> {
    if (isElectron) { await ipc.keychain.set(key, value); return }
    localStorage.setItem(key, value)
  },

  async removeKeychainValue(key: string): Promise<void> {
    if (isElectron) { await ipc.keychain.delete(key); return }
    localStorage.removeItem(key)
  },
}

export async function supabaseFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const config = await getSupabaseConfig()
  if (!config) throw new Error('Supabase not configured')

  const token = await platform.getToken()

  return fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: config.anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  })
}
