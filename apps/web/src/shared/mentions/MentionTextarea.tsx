import type { MentionCandidateView, StructuredMentionInput } from '@lankadws/contracts'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type ClipboardEvent, type CompositionEvent, type KeyboardEvent } from 'react'
import { api } from '../api/client'
import { Avatar } from '../ui'
import { reconcileMentionChange } from './mentionText'

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
}) {
  const id = useId()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const [active, setActive] = useState<ActiveMentionQuery | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const candidates = useQuery({
    queryKey: ['mention-candidates', candidateUrl, active?.query ?? ''],
    queryFn: () => api<{ items: MentionCandidateView[] }>(
      `${candidateUrl}${candidateUrl?.includes('?') ? '&' : '?'}q=${encodeURIComponent(active?.query ?? '')}&limit=8`,
    ),
    enabled: Boolean(candidateUrl && active),
    staleTime: 30_000,
  })
  const items = candidates.data?.items ?? []

  useEffect(() => setActiveIndex(0), [active?.query, candidateUrl])

  function detectActive(nextValue: string, caret: number | null) {
    if (caret === null || !candidateUrl) {
      setActive(null)
      return
    }
    const beforeCaret = nextValue.slice(0, caret)
    const match = /(?:^|[\s([{])@([^\s@]*)$/u.exec(beforeCaret)
    if (!match) {
      setActive(null)
      return
    }
    const query = match[1] ?? ''
    setActive({ start: caret - query.length - 1, end: caret, query })
  }

  function selectCandidate(candidate: MentionCandidateView) {
    if (!active) return
    const mentionText = `@${candidate.displayName}`
    const nextValue = `${value.slice(0, active.start)}${mentionText}${value.slice(active.end)}`
    const reconciled = reconcileMentionChange(value, nextValue, mentions)
      .filter((mention) => mention.end <= active.start || mention.start >= active.end)
    const nextMention: StructuredMentionInput = {
      userId: candidate.id,
      start: active.start,
      end: active.start + mentionText.length,
      label: candidate.displayName,
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
      <label className={visuallyHiddenLabel ? 'mention-field__label is-visually-hidden' : 'mention-field__label'} htmlFor={id}>{label}</label>
      <div className="mention-field__input">
        <textarea
          ref={(element) => {
            textareaRef.current = element
            onTextareaRef?.(element)
          }}
          id={id}
          autoFocus={autoFocus}
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
          <div className="mention-field__results" id={`${id}-mentions`} role="listbox" aria-label={`${label}: варіанти згадок`}>
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
                <Avatar name={candidate.displayName} src={candidate.avatarAsset} size="sm" />
                <span>
                  <strong>{candidate.displayName}</strong>
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
