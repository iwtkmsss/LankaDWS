import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Time-based one-time passwords (RFC 6238) compatible with Google Authenticator, Microsoft
 * Authenticator, Duo Mobile and similar apps: HMAC-SHA1, 6 digits, 30-second steps.
 * Built on node:crypto so the application needs no OTP dependency.
 */
export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return output
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/gu, '')
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index < 0) throw new Error('Invalid base32 secret')
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

/** A new random 160-bit secret, base32-encoded as authenticator apps expect. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** The HOTP value (RFC 4226) for one counter. */
export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8)
  message.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', secret).update(message).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3]
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS)
}

/**
 * Returns the time step a code matches within ±`window` steps (clock drift tolerance), or null.
 * The caller rejects a step it has already accepted to stop the same code being replayed.
 */
export function matchTotp(secretBase32: string, code: string, nowMs = Date.now(), window = 1): number | null {
  if (!/^\d{6}$/u.test(code)) return null
  const secret = base32Decode(secretBase32)
  const current = totpStep(nowMs)
  const expected = Buffer.from(code)
  let matched: number | null = null
  // Every candidate is compared so the timing does not reveal which step matched.
  for (let step = current - window; step <= current + window; step += 1) {
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), expected) && matched === null) matched = step
  }
  return matched
}

/** The `otpauth://` URI an authenticator app reads from a QR code or a link. */
export function totpUri(secretBase32: string, account: string, issuer = 'LankaDWS'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SECONDS) })
  return `otpauth://totp/${label}?${params.toString()}`
}
