import { isElectron, ipc, getSupabaseConfig } from './electron'
import { Preferences } from '@capacitor/preferences'

const prefGet = async (key: string): Promise<string | null> => {
  const { value } = await Preferences.get({ key })
  return value
}
const prefSet = async (key: string, value: string): Promise<void> => {
  await Preferences.set({ key, value })
}
const prefRemove = async (key: string): Promise<void> => {
  await Preferences.remove({ key })
}

export const platform = {
  isElectron,
  isMobile: !isElectron,

  async getToken(): Promise<string | null> {
    if (isElectron) return ipc.keychain.get('supabase_access_token')
    return prefGet('supabase_access_token')
  },

  async setToken(token: string): Promise<void> {
    if (isElectron) { await ipc.keychain.set('supabase_access_token', token); return }
    await prefSet('supabase_access_token', token)
  },

  async clearToken(): Promise<void> {
    if (isElectron) { await ipc.keychain.delete('supabase_access_token'); return }
    await prefRemove('supabase_access_token')
  },

  async getKeychainValue(key: string): Promise<string | null> {
    if (isElectron) return ipc.keychain.get(key)
    return prefGet(key)
  },

  async setKeychainValue(key: string, value: string): Promise<void> {
    if (isElectron) { await ipc.keychain.set(key, value); return }
    await prefSet(key, value)
  },

  async removeKeychainValue(key: string): Promise<void> {
    if (isElectron) { await ipc.keychain.delete(key); return }
    await prefRemove(key)
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
