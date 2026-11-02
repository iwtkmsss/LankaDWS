import { useId, useLayoutEffect, useRef, useState, type ComponentPropsWithRef } from 'react'
import { ResizeHandle } from './ResizeHandle'

export function ResizableTextarea(props: ComponentPropsWithRef<'textarea'>) {
  // Hidden transport fields keep their original DOM and focus forwarding.
  return props.hidden ? <textarea {...props} /> : <VisibleTextarea {...props} />
}

function VisibleTextarea({ ref, id, ...props }: ComponentPropsWithRef<'textarea'>) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [resizable, setResizable] = useState(false)
  useLayoutEffect(() => {
    // Preserve contextual policies such as auto-growing chat inputs (resize: none).
    if (textareaRef.current) setResizable(getComputedStyle(textareaRef.current).resize !== 'none')
  }, [])

  return <span className="resizable-textarea" data-resizable={resizable || undefined}>
    <textarea {...props} id={textareaId} ref={(element) => {
      textareaRef.current = element
      if (typeof ref === 'function') return ref(element)
      if (ref) ref.current = element
    }} />
    {resizable && <ResizeHandle targetRef={textareaRef} controls={textareaId} disabled={props.disabled} />}
  </span>
}
