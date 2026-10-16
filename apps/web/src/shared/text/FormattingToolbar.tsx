import { useState } from 'react'
import { Bold, Italic, Strikethrough, Heading2, List, ListOrdered, Quote, Code, Link } from 'lucide-react'
import { safeEditorLink } from './richTextDom'

const actions = [
  { label: 'Жирний', Icon: Bold, command: 'bold' },
  { label: 'Курсив', Icon: Italic, command: 'italic' },
  { label: 'Закреслений', Icon: Strikethrough, command: 'strikeThrough' },
  { label: 'Заголовок', Icon: Heading2, command: 'formatBlock', value: 'h3' },
  { label: 'Маркований список', Icon: List, command: 'insertUnorderedList' },
  { label: 'Нумерований список', Icon: ListOrdered, command: 'insertOrderedList' },
  { label: 'Цитата', Icon: Quote, command: 'formatBlock', value: 'blockquote' },
  { label: 'Код', Icon: Code, command: 'code' },
  { label: 'Посилання', Icon: Link, command: 'link' },
]

export function FormattingToolbar({ onCommand, onSaveSelection, disabled }: {
  onCommand: (command: string, value?: string) => void; onSaveSelection: () => void; disabled?: boolean
}) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [href, setHref] = useState('')
  function addLink() {
    onCommand('createLink', href.replaceAll('(', '%28').replaceAll(')', '%29'))
    setLinkOpen(false)
  }
  return <>
    <div className="formatting-toolbar" role="group" aria-label="Форматування тексту">
      {actions.map((action) => <button key={action.label} type="button" title={action.label} aria-label={action.label} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        if (action.command === 'link') { onSaveSelection(); setHref(''); setLinkOpen(true) }
        else onCommand(action.command, action.value)
      }}><action.Icon size={16} /></button>)}
    </div>
    {linkOpen && <div className="formatting-link">
      <label>Адреса посилання<input type="url" value={href} autoFocus placeholder="https://" onChange={(event) => setHref(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); setLinkOpen(false) }
        if (event.key === 'Enter') { event.preventDefault(); if (safeEditorLink(href)) addLink() }
      }} /></label>
      <button type="button" disabled={disabled || !safeEditorLink(href)} onClick={addLink}>Додати</button>
      <button type="button" onClick={() => setLinkOpen(false)}>Скасувати</button>
    </div>}
  </>
}
