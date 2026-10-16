import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type Ref } from 'react'
import type { StructuredMentionInput } from '@lankadws/contracts'
import { FormattingToolbar } from './FormattingToolbar'
import { editorMarkup, readEditor, selectEditorRange } from './richTextDom'

export interface RichEditorHandle {
  focus: () => void
  setSelection: (start: number, end?: number) => void
}

export function RichTextEditor({ ref, value, mentions = [], onChange, onCaret, onKeyDown, onPaste, onBlur, id, label, rows = 3, maxLength, placeholder, disabled, autoFocus, required, ...aria }: {
  ref?: Ref<RichEditorHandle>; value: string; mentions?: StructuredMentionInput[]
  onChange: (value: string, mentions: StructuredMentionInput[], caret: number) => void
  onCaret?: (caret: number) => void; onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void; onBlur?: () => void
  id: string; label: string; rows?: number; maxLength?: number; placeholder?: string; disabled?: boolean; autoFocus?: boolean; required?: boolean
  'aria-controls'?: string; 'aria-activedescendant'?: string
}) {
  const elementRef = useRef<HTMLDivElement>(null)
  const lastValue = useRef<string | null>(null)
  const lastMentions = useRef('')
  const savedRange = useRef<Range | null>(null)
  const composing = useRef(false)
  const mentionsKey = JSON.stringify(mentions)
  useImperativeHandle(ref, () => ({
    focus: () => elementRef.current?.focus(),
    setSelection: (start, end) => { if (elementRef.current) selectEditorRange(elementRef.current, start, end) },
  }), [])
  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element || (lastValue.current === value && lastMentions.current === mentionsKey)) return
    element.innerHTML = editorMarkup(value, mentions)
    lastValue.current = value
    lastMentions.current = mentionsKey
    savedRange.current = null
  }, [value, mentions, mentionsKey])
  useEffect(() => { if (autoFocus) elementRef.current?.focus() }, [autoFocus])

  function remember() {
    const element = elementRef.current
    const selection = element?.ownerDocument.getSelection()
    if (element && selection?.rangeCount && element.contains(selection.getRangeAt(0).commonAncestorContainer)) savedRange.current = selection.getRangeAt(0).cloneRange()
  }
  function publish() {
    const element = elementRef.current
    if (!element) return
    const next = readEditor(element)
    if (maxLength && next.body.length > maxLength) {
      element.ownerDocument.execCommand('undo')
      return
    }
    lastValue.current = next.body
    lastMentions.current = JSON.stringify(next.mentions)
    remember()
    onChange(next.body, next.mentions, next.end)
  }
  function command(name: string, argument?: string) {
    const element = elementRef.current
    if (!element || disabled) return
    if (name !== 'createLink') remember()
    element.focus()
    const selection = element.ownerDocument.getSelection()
    if (savedRange.current && element.contains(savedRange.current.commonAncestorContainer)) {
      selection?.removeAllRanges(); selection?.addRange(savedRange.current)
    }
    const document = element.ownerDocument
    if (name === 'code') {
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null
      const existing = range?.startContainer.parentElement?.closest('code')
      if (existing && element.contains(existing)) {
        range?.selectNode(existing)
        document.execCommand('insertHTML', false, existing.innerHTML)
      } else {
        const code = document.createElement('code')
        code.textContent = selection?.toString() || 'код'
        document.execCommand('insertHTML', false, code.outerHTML)
      }
    } else if (name === 'createLink' && selection?.isCollapsed) {
      const link = document.createElement('a')
      link.href = argument ?? ''
      link.textContent = argument ?? ''
      document.execCommand('insertHTML', false, link.outerHTML)
    } else {
      if (name === 'formatBlock' && selection?.anchorNode?.parentElement?.closest(argument ?? 'p') && argument !== 'p') argument = 'p'
      document.execCommand(name, false, argument)
    }
    publish()
  }
  return <div className="rich-editor">
    <FormattingToolbar disabled={disabled} onCommand={command} onSaveSelection={remember} />
    <div ref={elementRef} id={id} role="textbox" aria-label={label} aria-multiline="true" aria-disabled={disabled || undefined} aria-required={required || undefined} {...aria}
      className="rich-editor__input formatted-text" contentEditable={!disabled} suppressContentEditableWarning
      data-placeholder={placeholder} data-empty={value.length === 0} style={{ '--editor-rows': rows } as CSSProperties}
      onInput={() => { if (!composing.current) publish() }}
      onCompositionStart={() => { composing.current = true }}
      onCompositionEnd={() => { composing.current = false; publish() }}
      onMouseUp={() => { remember(); if (elementRef.current) onCaret?.(readEditor(elementRef.current).end) }}
      onKeyUp={() => { remember(); if (elementRef.current) onCaret?.(readEditor(elementRef.current).end) }}
      onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing) return
        onKeyDown?.(event)
        if (!event.defaultPrevented && (event.ctrlKey || event.metaKey) && ['b', 'i'].includes(event.key.toLowerCase())) {
          event.preventDefault(); command(event.key.toLowerCase() === 'b' ? 'bold' : 'italic')
        }
      }}
      onPaste={(event) => {
        onPaste?.(event)
        if (event.defaultPrevented) return
        event.preventDefault()
        elementRef.current?.ownerDocument.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
        publish()
      }} onBlur={onBlur}
    />
  </div>
}
