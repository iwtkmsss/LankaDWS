import { useCallback, useEffect, useRef } from 'react'
import { ImagePlus } from 'lucide-react'
import { FEED_PHOTO_MIME_TYPES } from '@lankadws/contracts'

/** Toolbar action that picks images to place over the text. */
export function InlinePhotoButton({ disabled, onFiles }: { disabled?: boolean; onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return <>
    <input ref={input} type="file" hidden multiple tabIndex={-1} accept={FEED_PHOTO_MIME_TYPES.join(',')} aria-label="Фото в опис" disabled={disabled}
      onChange={(event) => { onFiles(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    <button type="button" aria-label="Вставити фото" title="Вставити фото" disabled={disabled}
      onMouseDown={(event) => event.preventDefault()} onClick={() => input.current?.click()}><ImagePlus size={16} /></button>
  </>
}

/** Object URLs for local previews, released when the component goes away. */
export function useObjectUrls(): (file: File) => string {
  const urls = useRef(new Set<string>())
  useEffect(() => {
    const current = urls.current
    return () => { current.forEach((url) => URL.revokeObjectURL(url)); current.clear() }
  }, [])
  return useCallback((file: File) => {
    const url = URL.createObjectURL(file)
    urls.current.add(url)
    return url
  }, [])
}
