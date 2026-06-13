/**
 * In-memory session store for the Electron main process.
 * Holds the Supabase access token so the sync worker can use it
 * without depending on keytar (Windows Credential Manager).
 */

let accessToken: string | null = null
let refreshToken: string | null = null

export function setSessionToken(token: string | null) {
  accessToken = token
}

export function getSessionToken(): string | null {
  return accessToken
}

export function setRefreshToken(token: string | null) {
  refreshToken = token
}

export function getRefreshToken(): string | null {
  return refreshToken
}
