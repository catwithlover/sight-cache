export type DeviceCredential = {
  id: string
  raw: string
  hash: string
  hint: string
}

const base64UrlEncode = (bytes: Uint8Array) => {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '')
}

export const hashDeviceToken = async (value: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export const createDeviceCredential = async (): Promise<DeviceCredential> => {
  const id = crypto.randomUUID()
  const secretBytes = new Uint8Array(32)
  crypto.getRandomValues(secretBytes)
  const secret = base64UrlEncode(secretBytes)
  const raw = `scd_${id}.${secret}`

  return {
    id,
    raw,
    hash: await hashDeviceToken(raw),
    hint: `scd_${id.slice(0, 8)}...${secret.slice(-6)}`,
  }
}
