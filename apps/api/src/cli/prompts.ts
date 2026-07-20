import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

export interface HiddenChunkResult {
  value: string
  output: string
  complete: boolean
  interrupted: boolean
}

export function consumeHiddenChunk(current: string, chunk: string): HiddenChunkResult {
  let value = current
  let output = ''
  const normalized = chunk.replaceAll('\u001b[200~', '').replaceAll('\u001b[201~', '')
  for (const character of normalized) {
    if (character === '\u0003') return { value, output, complete: false, interrupted: true }
    if (character === '\r' || character === '\n') return { value, output, complete: true, interrupted: false }
    if (character === '\u007f' || character === '\b') {
      if (value.length) {
        value = value.slice(0, -1)
        output += '\b \b'
      }
    } else if (character >= ' ') {
      value += character
      output += '*'
    }
  }
  return { value, output, complete: false, interrupted: false }
}

export async function promptText(label: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const suffix = defaultValue ? ` [${defaultValue}]` : ''
    const answer = (await rl.question(`${label}${suffix}: `)).trim()
    return answer || defaultValue || ''
  } finally {
    rl.close()
  }
}

export async function promptHidden(label: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') throw new Error('Masked TTY is required; passwords are never accepted as command arguments')
  stdout.write(`${label}: `)
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let value = ''
    const onData = (chunk: string) => {
      const result = consumeHiddenChunk(value, chunk)
      value = result.value
      stdout.write(result.output)
      if (result.interrupted) {
        cleanup()
        reject(new Error('Interrupted'))
      } else if (result.complete) {
        stdout.write('\n')
        cleanup()
        resolve(value)
      }
    }
    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
    }
    stdin.on('data', onData)
  })
}
