import type { KeyboardEvent } from 'react'

/**
 * True while an IME (Japanese, Chinese, Korean…) is composing text, so the
 * keystroke — typically Enter — confirms a conversion candidate and must not
 * submit, add or select anything. `keyCode === 229` covers Safari, which can
 * deliver `compositionend` before the confirming keydown and so reports
 * `isComposing: false` on it.
 */
export function isImeComposing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229
}
