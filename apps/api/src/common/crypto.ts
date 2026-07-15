import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import argon2 from 'argon2'
import { getConfig } from '../config/config.js'

export function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function randomTemporaryPassword(): string {
  return `${randomToken(18)}-A7!`
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function fingerprint(value: string, purpose: string): string {
  return createHmac('sha256', getConfig().SESSION_PEPPER).update(`${purpose}:${value}`).digest('hex')
}

export function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function hashPassword(value: string): Promise<string> {
  return argon2.hash(value, {
    type: argon2.argon2id,
    memoryCost: process.env.NODE_ENV === 'test' ? 4096 : 65536,
    timeCost: process.env.NODE_ENV === 'test' ? 1 : 3,
    parallelism: 1,
  })
}

export async function verifyPassword(hash: string, value: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, value)
  } catch {
    return false
  }
}

export function encryptSecret(value: string): string {
  const key = Buffer.from(getConfig().TOTP_ENCRYPTION_KEY, 'hex')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
}

export function decryptSecret(payload: string): string {
  const [ivText, tagText, encryptedText] = payload.split('.')
  if (!ivText || !tagText || !encryptedText) throw new Error('Invalid encrypted payload')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(getConfig().TOTP_ENCRYPTION_KEY, 'hex'), Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8')
}
