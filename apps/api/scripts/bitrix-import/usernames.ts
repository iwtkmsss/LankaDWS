// Canonical LankaDWS usernames for imported Bitrix accounts (contracts auth.ts: ^[a-z0-9._-]{3,32}$).
import { usernamePattern } from '@lankadws/contracts'

const TRANSLITERATION: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ь: '', ю: 'iu', я: 'ia', ы: 'y', э: 'e', ё: 'io', ъ: '', "'": '', '’': '', 'ʼ': '',
}

export function transliterate(value: string): string {
  return [...value.normalize('NFKC').toLocaleLowerCase('uk-UA')].map((character) => TRANSLITERATION[character] ?? character).join('')
}

/** Lower-cases, transliterates and replaces disallowed characters; returns '' when nothing usable is left. */
export function sanitizeUsername(value: string): string {
  const cleaned = transliterate(value.trim())
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/([._-])[._-]+/g, '$1')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 32)
    .replace(/[._-]+$/g, '')
  return usernamePattern.test(cleaned) ? cleaned : ''
}

/**
 * Picks a unique username for a Bitrix login: the login itself when it is already canonical, else the
 * local part of an e-mail login, else a transliteration, else `b24-<id>`. Collisions get `-<id>`.
 */
export function allocateUsername(login: string | null | undefined, bitrixId: number, taken: Set<string>): string {
  const raw = (login ?? '').trim()
  const lower = raw.toLowerCase()
  const candidates = [
    usernamePattern.test(lower) ? lower : '',
    raw.includes('@') ? sanitizeUsername(raw.slice(0, raw.indexOf('@'))) : '',
    sanitizeUsername(raw),
  ].filter(Boolean)
  const fallback = `b24-${bitrixId}`
  let chosen = candidates.find((candidate) => !taken.has(candidate))
  if (!chosen) {
    const base = candidates[0]
    const suffix = `-${bitrixId}`
    const withSuffix = base ? `${base.slice(0, 32 - suffix.length).replace(/[._-]+$/g, '')}${suffix}` : fallback
    chosen = usernamePattern.test(withSuffix) && !taken.has(withSuffix) ? withSuffix : fallback
  }
  if (taken.has(chosen)) throw new Error(`Username collision for Bitrix user ${bitrixId}`)
  taken.add(chosen)
  return chosen
}
