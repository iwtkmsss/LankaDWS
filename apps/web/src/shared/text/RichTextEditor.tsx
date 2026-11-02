import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import type { StructuredMentionInput } from '@lankadws/contracts'
import { FormattingToolbar } from './FormattingToolbar'
import { editorMarkup, readEditor, selectEditorRange } from './richTextDom'

export interface RichEditorHandle {
  focus: () => void
  setSelection: (start: number, end?: number) => void
  insertText: (text: string) => void
}

export function RichTextEditor({ ref, value, mentions = [], onChange, onCaret, onKeyDown, onPaste, onBlur, id, label, rows = 3, maxLength, placeholder, disabled, autoFocus, required, toolbarActions, ...aria }: {
  ref?: Ref<RichEditorHandle>; value: string; mentions?: StructuredMentionInput[]
  onChange: (value: string, mentions: StructuredMentionInput[], caret: number) => void
  onCaret?: (caret: number) => void; onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  onPaste?: (event: ClipboardEvent<HTMLDivElement>) => void; onBlur?: () => void
  id: string; label: string; rows?: number; maxLength?: number; placeholder?: string; disabled?: boolean; autoFocus?: boolean; required?: boolean
  'aria-controls'?: string; 'aria-activedescendant'?: string
  toolbarActions?: ReactNode
}) {
  const elementRef = useRef<HTMLDivElement>(null)
  const lastValue = useRef<string | null>(null)
  const lastMentions = useRef('')
  const savedRange = useRef<Range | null>(null)
  const composing = useRef(false)
  const [formatting, setFormatting] = useState({ size: 12, commands: [] as string[] })
  const mentionsKey = JSON.stringify(mentions)
  useImperativeHandle(ref, () => ({
    focus: () => elementRef.current?.focus(),
    setSelection: (start, end) => { if (elementRef.current) selectEditorRange(elementRef.current, start, end) },
    insertText: (text) => command('insertText', text),
  }))
  useLayoutEffect(() => {
    const element = elementRef.current
    if (!element || (lastValue.current === value && lastMentions.current === mentionsKey)) return
    element.innerHTML = editorMarkup(value, mentions)
    lastValue.current = value
    lastMentions.current = mentionsKey
    savedRange.current = null
  }, [value, mentions, mentionsKey])
  useEffect(() => { if (autoFocus) elementRef.current?.focus() }, [autoFocus])
  useEffect(() => {
    const document = elementRef.current?.ownerDocument
    document?.addEventListener('selectionchange', remember)
    return () => document?.removeEventListener('selectionchange', remember)
  })

  function remember() {
    const element = elementRef.current
    const selection = element?.ownerDocument.getSelection()
    if (element && selection?.rangeCount && element.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      savedRange.current = selection.getRangeAt(0).cloneRange()
      const node = selection.anchorNode
      const parent = node instanceof HTMLElement ? node : node?.parentElement
      const size = parent ? Math.round(parseFloat(getComputedStyle(parent).fontSize) * .75) : 12
      const commands = ['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull']
        .filter((name) => element.ownerDocument.queryCommandState?.(name))
      setFormatting((current) => current.size === size && current.commands.join() === commands.join() ? current : { size, commands })
    }
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
    if (name === 'fontSize') {
      const size = Number(argument)
      if (!Number.isInteger(size) || size < 10 || size > 36) return
      document.execCommand('fontSize', false, '7')
      element.querySelectorAll('font[size="7"]').forEach((font) => {
        font.removeAttribute('size')
        ;(font as HTMLElement).style.fontSize = `${size}pt`
      })
    } else if (name === 'table') {
      const [rows, columns] = (argument ?? '2,2').split(',').map(Number)
      if (!rows || !columns || !Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows > 10 || columns > 10) return
      document.execCommand('insertHTML', false, `<table><tbody>${`<tr>${'<td> </td>'.repeat(columns)}</tr>`.repeat(rows)}</tbody></table><p><br></p>`)
    } else if (name === 'code') {
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
    <FormattingToolbar disabled={disabled} fontSize={formatting.size} activeCommands={formatting.commands} onCommand={command} onSaveSelection={remember} extraActions={toolbarActions} />
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
