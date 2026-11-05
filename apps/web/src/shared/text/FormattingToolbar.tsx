import { useState, type ReactNode } from 'react'
import { Bold, Italic, Underline, List, ListOrdered, Quote, Link, Unlink, AlignLeft, AlignCenter, AlignRight, AlignJustify, Eraser, Table, Smile, Undo2, Redo2 } from 'lucide-react'
import { safeEditorLink } from './richTextDom'

const actions = [
  { label: 'Жирний', Icon: Bold, command: 'bold' },
  { label: 'Курсив', Icon: Italic, command: 'italic' },
  { label: 'Підкреслений', Icon: Underline, command: 'underline' },
  { label: 'Цитата', Icon: Quote, command: 'formatBlock', value: 'blockquote' },
  { label: 'Маркований список', Icon: List, command: 'insertUnorderedList' },
  { label: 'Нумерований список', Icon: ListOrdered, command: 'insertOrderedList' },
  { label: 'Вирівняти ліворуч', Icon: AlignLeft, command: 'justifyLeft' },
  { label: 'Вирівняти по центру', Icon: AlignCenter, command: 'justifyCenter' },
  { label: 'Вирівняти праворуч', Icon: AlignRight, command: 'justifyRight' },
  { label: 'Вирівняти по ширині', Icon: AlignJustify, command: 'justifyFull' },
  { label: 'Посилання', Icon: Link, command: 'link' },
  { label: 'Прибрати посилання', Icon: Unlink, command: 'unlink' },
  { label: 'Очистити форматування', Icon: Eraser, command: 'removeFormat' },
  { label: 'Таблиця', Icon: Table, command: 'table' },
  { label: 'Смайли', Icon: Smile, command: 'emoji' },
]

export function FormattingToolbar({ onCommand, onSaveSelection, disabled, fontSize = 12, activeCommands = [], extraActions }: {
  onCommand: (command: string, value?: string) => void; onSaveSelection: () => void; disabled?: boolean; fontSize?: number; activeCommands?: string[]
  extraActions?: ReactNode
}) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [href, setHref] = useState('')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [tableOpen, setTableOpen] = useState(false)
  const [tableRows, setTableRows] = useState(2)
  const [tableColumns, setTableColumns] = useState(2)
  function addLink() {
    onCommand('createLink', href.replaceAll('(', '%28').replaceAll(')', '%29'))
    setLinkOpen(false)
  }
  return <>
    <div className="formatting-toolbar" role="group" aria-label="Форматування тексту">
      <select aria-label="Розмір шрифту" title="Розмір шрифту" disabled={disabled} value={fontSize} onFocus={onSaveSelection} onChange={(event) => {
        onCommand('fontSize', event.target.value)
      }}>{Array.from({ length: 27 }, (_, index) => index + 10).map((size) => <option key={size} value={size}>{size} pt</option>)}</select>
      {actions.map((action) => <button key={action.label} type="button" title={action.label} aria-label={action.label} aria-pressed={activeCommands.includes(action.command)} disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => {
        if (action.command === 'link') { onSaveSelection(); setHref(''); setLinkOpen(true) }
        else if (action.command === 'emoji') { onSaveSelection(); setEmojiOpen(!emojiOpen) }
        else if (action.command === 'table') { onSaveSelection(); setTableOpen(!tableOpen) }
        else onCommand(action.command, action.value)
      }}><action.Icon size={16} /></button>)}
      <button type="button" title="Скасувати дію" aria-label="Скасувати дію" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => onCommand('undo')}><Undo2 size={16} /></button>
      <button type="button" title="Повторити дію" aria-label="Повторити дію" disabled={disabled} onMouseDown={(event) => event.preventDefault()} onClick={() => onCommand('redo')}><Redo2 size={16} /></button>
      {extraActions}
    </div>
    {tableOpen && <div className="formatting-link" onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setTableOpen(false) } }}>
      <label>Рядків<select autoFocus value={tableRows} disabled={disabled} onChange={(event) => setTableRows(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>
      <label>Стовпців<select value={tableColumns} disabled={disabled} onChange={(event) => setTableColumns(Number(event.target.value))}>{Array.from({ length: 10 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></label>
      <button type="button" disabled={disabled} onClick={() => { onCommand('table', `${tableRows},${tableColumns}`); setTableOpen(false) }}>Вставити таблицю</button>
      <button type="button" onClick={() => setTableOpen(false)}>Скасувати</button>
    </div>}
    {emojiOpen && <div className="formatting-emoji" role="group" aria-label="Оберіть смайл">{['🙂', '😊', '😀', '😉', '❤️', '👍', '🎉', '✅'].map((emoji) => <button key={emoji} type="button" disabled={disabled} aria-label={`Вставити ${emoji}`} onMouseDown={(event) => event.preventDefault()} onClick={() => { onCommand('insertText', emoji); setEmojiOpen(false) }}>{emoji}</button>)}<button type="button" onClick={() => setEmojiOpen(false)}>Закрити</button></div>}
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
