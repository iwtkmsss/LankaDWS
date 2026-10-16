import { useId, useRef, useState, type TextareaHTMLAttributes } from 'react'
import { RichTextEditor, type RichEditorHandle } from './RichTextEditor'

export function FormattedTextarea({ label, value, defaultValue, onChange, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const generatedId = useId()
  const id = props.id ?? generatedId
  const ref = useRef<HTMLTextAreaElement>(null)
  const editorRef = useRef<RichEditorHandle>(null)
  const [local, setLocal] = useState(String(defaultValue ?? ''))
  const current = String(value ?? local)
  function change(next: string) {
    const element = ref.current
    if (!element) return
    // Go through React's normal input event so existing form dirty guards and
    // controlled handlers also see edits made by toolbar buttons.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, next)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return <div className="formatted-editor">
    <label htmlFor={id} onClick={() => editorRef.current?.focus()}>{label}</label>
    <RichTextEditor ref={editorRef} id={id} label={label} value={current} onChange={change}
      rows={props.rows} maxLength={props.maxLength} placeholder={props.placeholder} disabled={props.disabled} autoFocus={props.autoFocus} required={props.required} />
    <textarea {...props} id={`${id}-value`} hidden aria-hidden="true" tabIndex={-1} autoFocus={false} ref={ref} value={current}
      onInvalid={(event) => { event.preventDefault(); editorRef.current?.focus() }}
      onChange={(event) => { setLocal(event.target.value); onChange?.(event) }} />
  </div>
}
