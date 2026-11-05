import type { ComponentProps, ReactNode } from 'react'
import './message-composer.css'

export function MessageComposerFrame({
  className = '',
  dropTargetProps,
  overlay,
  reply,
  attachments,
  leadingActions,
  input,
  sendAction,
}: {
  className?: string
  dropTargetProps?: Omit<ComponentProps<'div'>, 'children' | 'className'>
  overlay?: ReactNode
  reply?: ReactNode
  attachments?: ReactNode
  leadingActions?: ReactNode
  input: ReactNode
  sendAction: ReactNode
}) {
  return (
    <div className={`message-composer ${className}`.trim()} {...dropTargetProps}>
      {overlay}
      {reply}
      {attachments}
      <div className="message-composer__row">
        {leadingActions}
        {input}
        {sendAction}
      </div>
    </div>
  )
}
