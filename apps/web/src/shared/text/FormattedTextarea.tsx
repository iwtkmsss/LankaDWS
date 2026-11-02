import { useId, useRef, useState, type TextareaHTMLAttributes } from 'react'
import { ImagePlus } from 'lucide-react'
import { RichTextEditor, type RichEditorHandle } from './RichTextEditor'
import { MentionTextarea } from '../mentions/MentionTextarea'

export function FormattedTextarea({ label, value, defaultValue, onChange, candidateUrl, onPhotos, photosDisabled, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; candidateUrl?: string; onPhotos?: (files: File[]) => void; photosDisabled?: boolean }) {
  const generatedId = useId()
  const id = props.id ?? generatedId
  const ref = useRef<HTMLTextAreaElement>(null)
  const editorRef = useRef<RichEditorHandle>(null)
  const mentionInputRef = useRef<HTMLTextAreaElement | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const photoAction = onPhotos ? <><input ref={photoInputRef} type="file" accept="image/*" multiple hidden tabIndex={-1}
    onChange={(event) => { onPhotos(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    <button type="button" aria-label="Вставити фото" title="Вставити фото" disabled={props.disabled || photosDisabled}
      onMouseDown={(event) => event.preventDefault()} onClick={() => photoInputRef.current?.click()}><ImagePlus size={16} /></button></> : undefined
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
    {candidateUrl ? <MentionTextarea label={label} value={current} mentions={[]} candidateUrl={candidateUrl}
      formatting linkMentions maxLength={props.maxLength ?? 20000} rows={props.rows} placeholder={props.placeholder} disabled={props.disabled}
      toolbarActions={photoAction}
      onTextareaRef={(element) => { mentionInputRef.current = element }}
      onChange={change} /> : <><label htmlFor={id} onClick={() => editorRef.current?.focus()}>{label}</label>
    <RichTextEditor ref={editorRef} id={id} label={label} value={current} onChange={change}
      toolbarActions={photoAction}
      rows={props.rows} maxLength={props.maxLength} placeholder={props.placeholder} disabled={props.disabled} autoFocus={props.autoFocus} required={props.required} /></>}
    <textarea {...props} id={`${id}-value`} hidden aria-hidden="true" tabIndex={-1} autoFocus={false} ref={ref} value={current}
      onInvalid={(event) => { event.preventDefault(); if (candidateUrl) mentionInputRef.current?.focus(); else editorRef.current?.focus() }}
      onChange={(event) => { setLocal(event.target.value); onChange?.(event) }} />
  </div>
}
