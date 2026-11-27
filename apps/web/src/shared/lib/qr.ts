/**
 * A small QR Code encoder (ISO/IEC 18004): byte mode, error-correction level M, versions 1–10
 * (up to 213 bytes), enough for an `otpauth://` link. Written in-house so the authenticator
 * enrolment needs no dependency. Returns the module matrix; `qrSvgPath` turns it into an SVG path.
 */

const MAX_VERSION = 10
// Level M, indexed by version (index 0 unused).
const ECC_CODEWORDS_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26]
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5]
const FORMAT_ECL_BITS_M = 0

function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (version >= 7) result -= 36
  }
  return result
}

function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_CODEWORDS_PER_BLOCK[version] * NUM_BLOCKS[version]
}

function gfMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z
}

function reedSolomonDivisor(degree: number): number[] {
  const result = Array.from({ length: degree }, () => 0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMultiply(root, 0x02)
  }
  return result
}

/** The error-correction codewords for one block of data codewords. */
export function reedSolomonRemainder(data: readonly number[], degree: number): number[] {
  const divisor = reedSolomonDivisor(degree)
  const result = Array.from({ length: degree }, () => 0)
  for (const byte of data) {
    const factor = byte ^ (result.shift() ?? 0)
    result.push(0)
    for (let i = 0; i < result.length; i += 1) result[i] ^= gfMultiply(divisor[i], factor)
  }
  return result
}

/** The 15 format bits (level M) for a mask, already XOR-ed with the fixed pattern. */
export function formatBits(mask: number): number {
  const data = (FORMAT_ECL_BITS_M << 3) | mask
  let remainder = data
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537)
  return ((data << 10) | remainder) ^ 0x5412
}

function versionBits(version: number): number {
  let remainder = version
  for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25)
  return (version << 12) | remainder
}

const bit = (value: number, index: number) => ((value >>> index) & 1) !== 0

function alignmentPositions(version: number): number[] {
  if (version === 1) return []
  const size = version * 4 + 17
  const numAlign = Math.floor(version / 7) + 2
  const step = Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2
  const result = [6]
  for (let position = size - 7; result.length < numAlign; position -= step) result.splice(1, 0, position)
  return result
}

/** Data and error-correction codewords, split into blocks and interleaved. */
function codewords(bytes: Uint8Array, version: number): number[] {
  const capacityBits = dataCodewords(version) * 8
  const bits: number[] = []
  const push = (value: number, length: number) => { for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1) }
  push(0b0100, 4)
  push(bytes.length, version <= 9 ? 8 : 16)
  for (const byte of bytes) push(byte, 8)
  push(0, Math.min(4, capacityBits - bits.length))
  push(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8)
  const data: number[] = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((value, b) => (value << 1) | b, 0))

  const numBlocks = NUM_BLOCKS[version]
  const blockEcc = ECC_CODEWORDS_PER_BLOCK[version]
  const rawCodewords = Math.floor(rawDataModules(version) / 8)
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLength = Math.floor(rawCodewords / numBlocks)
  const blocks: number[][] = []
  for (let i = 0, offset = 0; i < numBlocks; i += 1) {
    const block = data.slice(offset, offset + shortBlockLength - blockEcc + (i < numShortBlocks ? 0 : 1))
    offset += block.length
    const ecc = reedSolomonRemainder(block, blockEcc)
    if (i < numShortBlocks) block.push(0)
    blocks.push([...block, ...ecc])
  }
  const result: number[] = []
  for (let i = 0; i < blocks[0].length; i += 1) {
    blocks.forEach((block, j) => { if (i !== shortBlockLength - blockEcc || j >= numShortBlocks) result.push(block[i]) })
  }
  return result
}

function maskApplies(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  }
}

/** A simplified penalty (runs, 2×2 blocks, dark balance) used only to pick a well-scanning mask. */
function penalty(modules: boolean[][]): number {
  const size = modules.length
  let score = 0
  for (let line = 0; line < size; line += 1) {
    for (const horizontal of [true, false]) {
      let run = 1
      for (let i = 1; i <= size; i += 1) {
        const same = i < size && (horizontal ? modules[line][i] === modules[line][i - 1] : modules[i][line] === modules[i - 1][line])
        if (same) { run += 1; continue }
        if (run >= 5) score += 3 + run - 5
        run = 1
      }
    }
  }
  let dark = 0
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (modules[y][x]) dark += 1
      if (x < size - 1 && y < size - 1) {
        const color = modules[y][x]
        if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1]) score += 3
      }
    }
  }
  const total = size * size
  score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10
  return score
}

/** Encodes text (UTF-8) as a QR Code module matrix: `true` is a dark module. */
export function encodeQr(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text)
  let version = 1
  while (version <= MAX_VERSION && 4 + (version <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(version) * 8) version += 1
  if (version > MAX_VERSION) throw new Error('Text is too long for the QR encoder')
  const size = version * 4 + 17
  const modules = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  const reserved = Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  const setFunction = (x: number, y: number, dark: boolean) => { modules[y][x] = dark; reserved[y][x] = true }

  for (let i = 0; i < size; i += 1) { setFunction(6, i, i % 2 === 0); setFunction(i, 6, i % 2 === 0) }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx
        const y = cy + dy
        const distance = Math.max(Math.abs(dx), Math.abs(dy))
        if (x >= 0 && x < size && y >= 0 && y < size) setFunction(x, y, distance !== 2 && distance !== 4)
      }
    }
  }
  const positions = alignmentPositions(version)
  const last = positions.length - 1
  positions.forEach((px, i) => positions.forEach((py, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return
    for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) setFunction(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
  }))
  const drawFormat = (mask: number) => {
    const bits = formatBits(mask)
    for (let i = 0; i <= 5; i += 1) setFunction(8, i, bit(bits, i))
    setFunction(8, 7, bit(bits, 6))
    setFunction(8, 8, bit(bits, 7))
    setFunction(7, 8, bit(bits, 8))
    for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, bit(bits, i))
    for (let i = 0; i < 8; i += 1) setFunction(size - 1 - i, 8, bit(bits, i))
    for (let i = 8; i < 15; i += 1) setFunction(8, size - 15 + i, bit(bits, i))
    setFunction(8, size - 8, true)
  }
  drawFormat(0)
  if (version >= 7) {
    const bits = versionBits(version)
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      setFunction(a, b, bit(bits, i))
      setFunction(b, a, bit(bits, i))
    }
  }

  const data = codewords(bytes, version)
  let index = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vertical : vertical
        if (!reserved[y][x] && index < data.length * 8) {
          modules[y][x] = bit(data[index >>> 3], 7 - (index & 7))
          index += 1
        }
      }
    }
  }

  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) if (!reserved[y][x] && maskApplies(mask, x, y)) modules[y][x] = !modules[y][x]
  }
  let bestMask = 0
  let bestPenalty = Infinity
  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(mask)
    drawFormat(mask)
    const score = penalty(modules)
    if (score < bestPenalty) { bestPenalty = score; bestMask = mask }
    applyMask(mask)
  }
  applyMask(bestMask)
  drawFormat(bestMask)
  return modules
}

/** One SVG path for the dark modules, offset by a 4-module quiet zone. */
export function qrSvgPath(modules: boolean[][], quietZone = 4): string {
  const parts: string[] = []
  modules.forEach((row, y) => row.forEach((dark, x) => { if (dark) parts.push(`M${x + quietZone} ${y + quietZone}h1v1h-1z`) }))
  return parts.join('')
}
