import { badRequest } from '../../common/errors.js'

const commonValues = new Set([
  'password',
  'password123',
  'qwerty123456789',
  'bertcrm',
  'bertcrm2026',
  'administrator',
])

export function assertPasswordPolicy(password: string, username: string, twoFactorRequired = false): void {
  const minimum = twoFactorRequired ? 8 : 15
  if (password.length < minimum || password.length > 128) {
    throw badRequest('password_policy', `Пароль має містити від ${minimum} до 128 символів.`)
  }
  const normalized = password.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  if (commonValues.has(normalized) || normalized.includes('lanka') || normalized.includes(username.toLowerCase())) {
    throw badRequest('password_blocklisted', 'Оберіть довшу парольну фразу, не пов’язану з Lanka або нікнеймом.')
  }
}
