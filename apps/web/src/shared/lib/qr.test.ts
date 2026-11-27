import { describe, expect, it } from 'vitest'
import { encodeQr, formatBits, qrSvgPath, reedSolomonRemainder } from './qr'

describe('QR encoder', () => {
  it('computes Reed–Solomon codewords of the reference 1-M "HELLO WORLD" block', () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17]
    expect(reedSolomonRemainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
  })

  it('produces the standard level-M format strings', () => {
    const expected = ['101010000010010', '101000100100101', '101111001111100', '101101101001011', '100010111111001', '100000011001110', '100111110010111', '100101010100000']
    expect(expected.map((_, mask) => formatBits(mask).toString(2).padStart(15, '0'))).toEqual(expected)
  })

  it('lays out finder patterns, timing and the dark module for an authenticator link', () => {
    const uri = 'otpauth://totp/LankaDWS:maria?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=LankaDWS&algorithm=SHA1&digits=6&period=30'
    const modules = encodeQr(uri)
    const size = modules.length
    expect((size - 17) % 4).toBe(0)
    expect(size).toBeGreaterThanOrEqual(41)
    for (const [x, y] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      expect(modules[y].slice(x, x + 7)).toEqual([true, true, true, true, true, true, true])
      expect(modules[y + 1].slice(x, x + 7)).toEqual([true, false, false, false, false, false, true])
      expect(modules[y + 3].slice(x, x + 7)).toEqual([true, false, true, true, true, false, true])
    }
    for (let i = 8; i < size - 8; i += 1) expect(modules[6][i]).toBe(i % 2 === 0)
    expect(modules[size - 8][8]).toBe(true)
    expect(qrSvgPath(modules)).toMatch(/^M4 4h1v1h-1z/u)
  })

  it('refuses text beyond its capacity', () => {
    expect(() => encodeQr('x'.repeat(300))).toThrow()
  })
})
