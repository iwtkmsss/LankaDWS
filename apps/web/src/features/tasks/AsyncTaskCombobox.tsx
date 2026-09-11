import { useEffect, useId, useRef, useState } from 'react'
import { LoaderCircle, Search } from 'lucide-react'
import { useDebouncedSearchValue } from '../../shared/lib/useDebouncedSearchValue'

export interface AsyncTaskOption { id: string; label: string; detail?: string }

export function AsyncTaskCombobox({
  label, value, selectedOption, onChange, loadOptions, placeholder, disabled = false, clearOnSelect = false, emptyLabel = 'Нічого не знайдено', loadOnOpen = false, initialEmptyLabel = 'Немає нещодавніх варіантів.',
}: {
  label: string
  value: string
  selectedOption?: AsyncTaskOption | null
  onChange: (value: string) => void
  loadOptions: (query: string, signal: AbortSignal) => Promise<AsyncTaskOption[]>
  placeholder: string
  disabled?: boolean
  clearOnSelect?: boolean
  emptyLabel?: string
  loadOnOpen?: boolean
  initialEmptyLabel?: string
}) {
  const inputId = useId()
  const listId = useId()
  const [text, setText] = useState(selectedOption?.label ?? '')
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AsyncTaskOption[]>([])
  const [active, setActive] = useState(-1)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const root = useRef<HTMLDivElement>(null)
  const { debouncedValue, isComposing, onCompositionStart, onCompositionEnd } = useDebouncedSearchValue(text)

  useEffect(() => { if (!open) setText(selectedOption?.label ?? '') }, [open, selectedOption?.label, value])
  useEffect(() => {
    if (!open || isComposing || (!loadOnOpen && Array.from(debouncedValue).length < 1)) { setItems([]); setState('idle'); return }
    const controller = new AbortController()
    setState('loading')
    void loadOptions(debouncedValue, controller.signal).then((next) => {
      if (!controller.signal.aborted) { setItems(next); setActive(next.length ? 0 : -1); setState('idle') }
    }).catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [debouncedValue, isComposing, loadOnOpen, loadOptions, open])

  const choose = (option: AsyncTaskOption) => { onChange(option.id); setText(clearOnSelect ? '' : option.label); setOpen(false); setActive(-1) }
  return <div className="async-task-combobox" ref={root} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) {
      setOpen(false)
      setText(selectedOption?.label ?? '')
    }
  }}>
    <label htmlFor={inputId}>{label}</label>
    <div className="search-field async-task-combobox__control">
      <Search size={16} aria-hidden />
      <input id={inputId} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" value={text} disabled={disabled}
        placeholder={placeholder} onFocus={() => setOpen(true)} onCompositionStart={onCompositionStart} onCompositionEnd={onCompositionEnd}
        onChange={(event) => { setText(event.target.value); setOpen(true); if (!event.target.value) onChange('') }}
        onKeyDown={(event) => {
          const activeOption = items[active]
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, items.length - 1)) }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
          if (event.key === 'Enter' && open && activeOption) { event.preventDefault(); choose(activeOption) }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); setText(selectedOption?.label ?? '') }
        }} />
      {state === 'loading' && <LoaderCircle className="is-spinning" size={16} aria-label="Завантаження" />}
      {open && <ul id={listId} role="listbox" aria-label={label}>
        {state === 'error' ? <li role="status">Не вдалося завантажити варіанти.</li>
          : items.length ? items.map((item, index) => <li key={item.id} role="option" aria-selected={index === active} className={index === active ? 'is-active' : ''} onMouseDown={(event) => { event.preventDefault(); choose(item) }}><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</li>)
          : state === 'loading' ? <li role="status">Завантажуємо…</li>
          : debouncedValue && !isComposing ? <li role="status">{emptyLabel}</li>
          : loadOnOpen ? <li role="status">{initialEmptyLabel}</li> : <li role="status">Введіть щонайменше 1 символ.</li>}
      </ul>}
    </div>
  </div>
}
