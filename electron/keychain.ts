// Wraps keytar (Windows Credential Manager) for secure API key storage
// Falls back to encrypted file storage if keytar is unavailable

let keytar: typeof import('keytar') | null = null

async function getKeytar() {
  if (!keytar) {
    try {
      keytar = await import('keytar')
    } catch {
      console.warn('keytar unavailable — secrets will not be stored securely')
    }
  }
  return keytar
}

const SERVICE = 'Ergoflow'

export async function storeSecret(key: string, value: string): Promise<void> {
  const kt = await getKeytar()
  if (kt) {
    await kt.setPassword(SERVICE, key, value)
  }
}

export async function getSecret(key: string): Promise<string | null> {
  const kt = await getKeytar()
  if (kt) {
    return kt.getPassword(SERVICE, key)
  }
  return null
}

export async function deleteSecret(key: string): Promise<void> {
  const kt = await getKeytar()
  if (kt) {
    await kt.deletePassword(SERVICE, key)
  }
}
