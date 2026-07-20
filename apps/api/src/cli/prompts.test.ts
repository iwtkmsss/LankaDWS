import { describe, expect, it } from 'vitest'
import { consumeHiddenChunk } from './prompts.js'

describe('masked CLI input', () => {
  it('accepts an entire pasted value and masks every character', () => {
    expect(consumeHiddenChunk('', 'secret-value\r')).toEqual({
      value: 'secret-value',
      output: '************',
      complete: true,
      interrupted: false,
    })
  })

  it('supports bracketed paste sequences', () => {
    expect(consumeHiddenChunk('', '\u001b[200~secret\u001b[201~')).toMatchObject({ value: 'secret', output: '******' })
  })
})
