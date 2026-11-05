import { useId, useRef, useState, type ClipboardEvent, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { RichTextEditor, type RichEditorHandle } from './RichTextEditor'
import { MentionTextarea } from '../mentions/MentionTextarea'

export function FormattedTextarea({ label, value, defaultValue, onChange, candidateUrl, toolbarActions, onPasteImages, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; candidateUrl?: string; toolbarActions?: ReactNode; onPasteImages?: (files: File[]) => void }) {
  const generatedId = useId()
  const id = props.id ?? generatedId
  const ref = useRef<HTMLTextAreaElement>(null)
  const editorRef = useRef<RichEditorHandle>(null)
  const mentionInputRef = useRef<HTMLTextAreaElement | null>(null)
  const [local, setLocal] = useState(String(defaultValue ?? ''))
  const current = String(value ?? local)
  function pasteImages(event: ClipboardEvent<HTMLElement>) {
    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'))
    if (!onPasteImages || !images.length) return
    event.preventDefault()
    onPasteImages(images)
  }
  function change(next: string) {
    const element = ref.current
    if (!element) return
    // Go through React's normal input event so existing form dirty guards and
    // controlled handlers also see edits made by toolbar buttons.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(element, next)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
  return <div className="formatted-editor">
    {candidateUrl ? <MentionTextarea label={label} value={current} mentions={[]} candidateUrl={candidateUrl}
      formatting linkMentions maxLength={props.maxLength ?? 20000} rows={props.rows} placeholder={props.placeholder} disabled={props.disabled}
      toolbarActions={toolbarActions}
      onPaste={pasteImages}
      onTextareaRef={(element) => { mentionInputRef.current = element }}
      onChange={change} /> : <><label htmlFor={id} onClick={() => editorRef.current?.focus()}>{label}</label>
    <RichTextEditor ref={editorRef} id={id} label={label} value={current} onChange={change}
      toolbarActions={toolbarActions}
      onPaste={pasteImages}
      rows={props.rows} maxLength={props.maxLength} placeholder={props.placeholder} disabled={props.disabled} autoFocus={props.autoFocus} required={props.required} /></>}
    <textarea {...props} id={`${id}-value`} hidden aria-hidden="true" tabIndex={-1} autoFocus={false} ref={ref} value={current}
      onInvalid={(event) => { event.preventDefault(); if (candidateUrl) mentionInputRef.current?.focus(); else editorRef.current?.focus() }}
      onChange={(event) => { setLocal(event.target.value); onChange?.(event) }} />
  </div>
}
