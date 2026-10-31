import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function keyFrom(secret: string | undefined) {
  if (!secret) throw new Error('STORE_SECRET_KEY is not set')
  const key = Buffer.from(secret, 'base64')
  if (key.length !== 32) throw new Error('STORE_SECRET_KEY must be 32 bytes, base64')
  return key
}

export function seal(value: unknown, secret: string | undefined): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`
}

export function unseal<T>(sealed: string, secret: string | undefined): T {
  if (!sealed.startsWith('v1:')) throw new Error('unknown credential format')
  const raw = Buffer.from(sealed.slice(3), 'base64')
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  return JSON.parse(
    Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'),
  ) as T
}

export function mask(value: string) {
  return value.length <= 6 ? '••••' : `${value.slice(0, 3)}••••${value.slice(-3)}`
}
