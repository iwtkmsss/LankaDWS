import { personName } from '../lib/personName'
import type { MentionCandidateView, StructuredMentionInput } from '@lankadws/contracts'
import { useUserSearch } from '../lib/useUserSearch'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ClipboardEvent, type CompositionEvent, type KeyboardEvent } from 'react'
import { Avatar } from '../ui'
import { reconcileMentionChange } from './mentionText'
import { RichTextEditor, type RichEditorHandle } from '../text/RichTextEditor'

interface ActiveMentionQuery {
  start: number
  end: number
  query: string
}

export function MentionTextarea({
  label,
  value,
  mentions,
  candidateUrl,
  onChange,
  className = '',
  rows = 3,
  maxLength,
  placeholder,
  disabled,
  autoFocus = false,
  visuallyHiddenLabel = false,
  onTextareaRef,
  onKeyDown,
  onPaste,
  formatting = false,
}: {
  label: string
  value: string
  mentions: StructuredMentionInput[]
  candidateUrl: string | null
  onChange: (value: string, mentions: StructuredMentionInput[]) => void
  className?: string
  rows?: number
  maxLength: number
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  visuallyHiddenLabel?: boolean
  onTextareaRef?: (element: HTMLTextAreaElement | null) => void
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void
  formatting?: boolean
}) {
  const id = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const editorRef = useRef<RichEditorHandle>(null)
  const inputRef = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const composing = useRef(false)
  const [active, setActive] = useState<ActiveMentionQuery | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const { users: candidates, items } = useUserSearch<MentionCandidateView>(active?.query ?? '', {
    endpoint: candidateUrl ?? undefined, enabled: Boolean(candidateUrl && active),
  })

  useEffect(() => setActiveIndex(0), [active?.query, candidateUrl])

  useLayoutEffect(() => {
    if (!active) return
    const panel = resultsRef.current!
    const input = inputRef.current!
    panel.showPopover?.()
    function place() {
      const rect = input.getBoundingClientRect()
      const viewport = window.visualViewport
      const top = (viewport?.offsetTop ?? 0) + 8
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - 8
      const left = (viewport?.offsetLeft ?? 0) + 8
      const right = (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - 8
      const above = Math.max(0, rect.top - top - 5)
      const below = Math.max(0, bottom - rect.bottom - 5)
      const upwards = above > below
      panel.style.width = `${Math.max(0, Math.min(rect.width, right - left))}px`
      panel.style.maxHeight = `${Math.min(260, upwards ? above : below)}px`
      panel.style.left = `${Math.max(left, Math.min(rect.left, right - panel.getBoundingClientRect().width))}px`
      panel.style.top = `${upwards ? Math.max(top, rect.top - 5 - panel.getBoundingClientRect().height) : rect.bottom + 5}px`
      panel.dataset.placement = upwards ? 'top' : 'bottom'
    }
    place()
    const resize = new ResizeObserver(place)
    resize.observe(input)
    resize.observe(panel)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
    }
  }, [active])

  useEffect(() => {
    resultsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])

  function detectActive(nextValue: string, caret: number | null) {
    if (caret === null || !candidateUrl) {
      setActive(null)
      return
    }
    const beforeCaret = nextValue.slice(0, caret)
    const match = /(?:^|[\s([{*~`])@([^\s@]*)$/u.exec(beforeCaret)
    if (!match) {
      setActive(null)
      return
    }
    const query = match[1] ?? ''
    setActive({ start: caret - query.length - 1, end: caret, query })
  }

  function selectCandidate(candidate: MentionCandidateView) {
    if (!active) return
    const mentionText = `@${personName(candidate.displayName)}`
    const nextValue = `${value.slice(0, active.start)}${mentionText}${value.slice(active.end)}`
    const reconciled = reconcileMentionChange(value, nextValue, mentions)
      .filter((mention) => mention.end <= active.start || mention.start >= active.end)
    const nextMention: StructuredMentionInput = {
      userId: candidate.id,
      start: active.start,
      end: active.start + mentionText.length,
      label: personName(candidate.displayName),
    }
    onChange(nextValue, [...reconciled, nextMention].toSorted((left, right) => left.start - right.start))
    setActive(null)
    requestAnimationFrame(() => {
      const caret = nextMention.end
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(caret, caret)
    })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!active) {
      if (event.key === 'Escape') setActive(null)
      onKeyDown?.(event)
      return
    }
    if (items.length === 0) {
      if (event.key === 'Enter') event.preventDefault()
      if (event.key === 'Escape') setActive(null)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % items.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + items.length) % items.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const selected = items[activeIndex]
      if (selected) selectCandidate(selected)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setActive(null)
    }
  }

  function finishComposition(event: CompositionEvent<HTMLTextAreaElement>) {
    composing.current = false
    detectActive(event.currentTarget.value, event.currentTarget.selectionStart)
  }

  return (
    <div className={`mention-field ${className}`.trim()}>
      <label className={visuallyHiddenLabel ? 'mention-field__label is-visually-hidden' : 'mention-field__label'} htmlFor={id} onClick={() => { if (formatting) editorRef.current?.focus() }}>{label}</label>
      <div className="mention-field__input" ref={inputRef}>
        {formatting && <RichTextEditor ref={editorRef} id={id} label={label} value={value} mentions={mentions}
          rows={rows} maxLength={maxLength} placeholder={placeholder} disabled={disabled} autoFocus={autoFocus}
          aria-controls={active ? `${id}-mentions` : undefined}
          aria-activedescendant={active && items[activeIndex] ? `${id}-mention-${items[activeIndex]!.id}` : undefined}
          onChange={(next, nextMentions, caret) => { onChange(next, nextMentions); detectActive(next, caret) }}
          onCaret={(caret) => detectActive(value, caret)}
          onKeyDown={(event) => handleKeyDown(event as unknown as KeyboardEvent<HTMLTextAreaElement>)}
          onPaste={(event) => onPaste?.(event as unknown as ClipboardEvent<HTMLTextAreaElement>)}
          onBlur={() => setActive(null)}
        />}
        <textarea
          ref={(element) => {
            textareaRef.current = element
            if (element && formatting) {
              element.focus = () => editorRef.current?.focus()
              const nativeSelect = HTMLTextAreaElement.prototype.setSelectionRange
              element.setSelectionRange = (start, end, direction) => {
                nativeSelect.call(element, start, end, direction)
                editorRef.current?.setSelection(start ?? 0, end ?? start ?? 0)
              }
            }
            onTextareaRef?.(element)
          }}
          id={formatting ? `${id}-value` : id}
          hidden={formatting}
          aria-hidden={formatting || undefined}
          tabIndex={formatting ? -1 : undefined}
          autoFocus={!formatting && autoFocus}
          value={value}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={disabled}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={active ? `${id}-mentions` : undefined}
          aria-activedescendant={active && items[activeIndex] ? `${id}-mention-${items[activeIndex]!.id}` : undefined}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={finishComposition}
          onChange={(event) => {
            const nextValue = event.target.value
            onChange(nextValue, reconcileMentionChange(value, nextValue, mentions))
            if (!composing.current) detectActive(nextValue, event.target.selectionStart)
          }}
          onBlur={() => setActive(null)}
          onClick={(event) => detectActive(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
        />
        {active && (
          <div ref={resultsRef} popover="manual" className="mention-field__results" id={`${id}-mentions`} role="listbox" aria-label={`${label}: варіанти згадок`}>
            {candidates.isLoading ? (
              <span role="status">Шукаємо колег…</span>
            ) : items.length > 0 ? items.map((candidate, index) => (
              <button
                type="button"
                role="option"
                id={`${id}-mention-${candidate.id}`}
                aria-selected={activeIndex === index}
                className={activeIndex === index ? 'is-active' : ''}
                key={candidate.id}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectCandidate(candidate)}
              >
                <Avatar name={personName(candidate.displayName)} src={candidate.avatarAsset} size="sm" />
                <span>
                  <strong>{personName(candidate.displayName)}</strong>
                  <small>@{candidate.username}{candidate.jobTitle ? ` · ${candidate.jobTitle}` : ''}</small>
                </span>
              </button>
            )) : <span role="status">Колег не знайдено</span>}
          </div>
        )}
      </div>
    </div>
  )
}
