import { Pin } from 'lucide-react'

export function ChatPinButton({ pinned, name, disabled, onClick }: {
  pinned: boolean
  name: string
  disabled: boolean
  onClick: () => void
}) {
  const label = `${pinned ? 'Відкріпити чат' : 'Закріпити чат'}: ${name}`
  return (
    <button type="button" className={`chat-pin-button${pinned ? ' is-pinned' : ''}`}
      title={label} aria-label={label} aria-pressed={pinned} disabled={disabled} onClick={onClick}>
      <Pin size={15} />
    </button>
  )
}
