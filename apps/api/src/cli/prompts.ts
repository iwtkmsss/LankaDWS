import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

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
      if (chunk === '\u0003') {
        cleanup()
        reject(new Error('Interrupted'))
      } else if (chunk === '\r' || chunk === '\n') {
        stdout.write('\n')
        cleanup()
        resolve(value)
      } else if (chunk === '\u007f' || chunk === '\b') {
        if (value.length) {
          value = value.slice(0, -1)
          stdout.write('\b \b')
        }
      } else if (chunk >= ' ') {
        value += chunk
        stdout.write('*')
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
