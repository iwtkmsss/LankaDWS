import { useEffect, useRef, useState } from 'react'
import { FEED_COMMENT_PHOTO_LIMIT, FEED_PHOTO_MAX_BYTES, FEED_PHOTO_MIME_TYPES, type FeedAttachmentView } from '@lankadws/contracts'
import { api } from '../../shared/api/client'

export interface FeedDraftPhoto { attachment: FeedAttachmentView; src: string }

export function feedPhotoError(file: File): string | null {
  if (!FEED_PHOTO_MIME_TYPES.some((mime) => mime === file.type)) return 'Оберіть фото PNG, JPEG, WebP або GIF.'
  if (!file.size || file.size > FEED_PHOTO_MAX_BYTES) return 'Кожне фото має бути непорожнім і не більшим за 10 МБ.'
  return null
}

export function useFeedCommentPhotos(postId: string, options?: { uploadUrl: string; limit: number }) {
  const [photos, setPhotos] = useState<FeedDraftPhoto[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const active = useRef(true)
  const request = useRef<AbortController | null>(null)
  const urls = useRef(new Set<string>())
  useEffect(() => {
    active.current = true
    const currentUrls = urls.current
    return () => { active.current = false; request.current?.abort(); currentUrls.forEach((url) => URL.revokeObjectURL(url)); currentUrls.clear() }
  }, [])

  async function add(files: File[]) {
    if (request.current || !files.length) return
    const limit = options?.limit ?? FEED_COMMENT_PHOTO_LIMIT
    const remaining = Math.max(0, limit - photos.length)
    const messages: string[] = files.length > remaining ? [options ? 'Перевищено ліміт фото або вкладень публікації.' : `До коментаря можна додати не більше ${FEED_COMMENT_PHOTO_LIMIT} фото.`] : []
    const selected = files.slice(0, remaining)
    const controller = new AbortController()
    request.current = controller
    setUploading(true)
    setError('')
    try {
      for (const file of selected) {
        const invalid = feedPhotoError(file)
        if (invalid) { messages.push(`${file.name}: ${invalid}`); continue }
        try {
          const form = new FormData()
          form.append('file', file)
          const attachment = await api<FeedAttachmentView>(options?.uploadUrl ?? `/feed/${encodeURIComponent(postId)}/comment-attachments`, { method: 'POST', body: form, signal: controller.signal })
          if (!active.current) return
          const src = URL.createObjectURL(file)
          urls.current.add(src)
          setPhotos((current) => [...current, { attachment, src }])
        } catch {
          if (controller.signal.aborted) return
          messages.push(`Не вдалося додати ${file.name}. Спробуйте ще раз.`)
        }
      }
    } finally {
      request.current = null
      if (active.current) { setUploading(false); setError([...new Set(messages)].join(' ')) }
    }
  }

  function remove(id: string) {
    setPhotos((current) => current.filter((photo) => {
      if (photo.attachment.id !== id) return true
      URL.revokeObjectURL(photo.src)
      urls.current.delete(photo.src)
      return false
    }))
  }
  function clear() {
    urls.current.forEach((url) => URL.revokeObjectURL(url))
    urls.current.clear()
    setPhotos([])
    setError('')
  }
  return { photos, uploading, error, add, remove, clear }
}
