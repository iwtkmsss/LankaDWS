import { afterEach, describe, expect, it, vi } from 'vitest'
import { idempotencyKey, randomId } from './client'

describe('browser-safe random IDs', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses randomUUID when the browser exposes it', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '12345678-1234-4123-8123-123456789abc',
      getRandomValues: vi.fn(),
    })

    expect(randomId()).toBe('12345678-1234-4123-8123-123456789abc')
  })

  it('builds a UUID v4 with getRandomValues on an insecure LAN origin', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set(Array.from({ length: 16 }, (_, index) => index))
        return bytes
      },
    })

    expect(randomId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f')
    expect(idempotencyKey('task')).toBe('task:00010203-0405-4607-8809-0a0b0c0d0e0f')
  })
})
