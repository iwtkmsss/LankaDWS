import { useEffect, useRef, useState } from 'react'
import { randomId } from '../../shared/api/client'

export const SHOWCASE_PHOTO_LIMIT = 5
export const SHOWCASE_PHOTO_MAX_BYTES = 10 * 1024 * 1024
export const SHOWCASE_PHOTO_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif'

export interface ShowcasePhoto {
  id: string
  src: string
  name: string
  ratio: number
  x: number
  y: number
  width: number
}

export function photoError(file: Pick<File, 'type' | 'size'>) {
  if (!SHOWCASE_PHOTO_ACCEPT.split(',').includes(file.type)) return 'Оберіть фото у форматі PNG, JPEG, WebP або GIF.'
  if (file.size > SHOWCASE_PHOTO_MAX_BYTES) return 'Кожне фото має бути не більше 10 МБ.'
  return null
}

export interface PhotoBounds { width: number; height: number }
export interface PhotoRect { x: number; y: number; width: number; height: number }
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(min, value), Math.max(min, max))

export function fitPhoto(photo: Pick<ShowcasePhoto, 'x' | 'y' | 'width' | 'ratio'>, bounds: PhotoBounds): PhotoRect {
  const width = Math.min(Math.max(64, clamp(photo.width, .1, 1) * bounds.width), bounds.width, bounds.height * photo.ratio)
  const height = width / photo.ratio
  return { x: clamp(photo.x * bounds.width, 0, bounds.width - width), y: clamp(photo.y, 0, bounds.height - height), width, height }
}

export function resizePhoto(rect: PhotoRect, ratio: number, bounds: PhotoBounds, corner: string, dx: number, dy: number): PhotoRect {
  const left = corner.includes('left'), top = corner.includes('top')
  const anchorX = left ? rect.x + rect.width : rect.x
  const anchorY = top ? rect.y + rect.height : rect.y
  const delta = Math.abs(dx) >= Math.abs(dy * ratio) ? (left ? -dx : dx) : (top ? -dy : dy) * ratio
  const maximum = Math.min(left ? anchorX : bounds.width - anchorX, (top ? anchorY : bounds.height - anchorY) * ratio)
  const width = clamp(rect.width + delta, Math.min(64, maximum), maximum)
  const height = width / ratio
  return { x: left ? anchorX - width : anchorX, y: top ? anchorY - height : anchorY, width, height }
}

export function useShowcasePhotos() {
  const [photos, setPhotos] = useState<ShowcasePhoto[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const urls = useRef(new Set<string>())
  const loading = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const ownedUrls = urls.current
    return () => { mounted.current = false; ownedUrls.forEach(URL.revokeObjectURL); ownedUrls.clear() }
  }, [])

  async function add(files: File[]) {
    if (loading.current || !files.length) return
    const remaining = SHOWCASE_PHOTO_LIMIT - photos.length
    if (!remaining) { setError('Можна додати до 5 фото.'); return }
    loading.current = true
    setBusy(true)
    const errors = files.length > remaining ? ['Можна додати до 5 фото. Зайві фото не додано.'] : []
    const added: ShowcasePhoto[] = []
    for (const file of files.slice(0, remaining)) {
      const invalid = photoError(file)
      if (invalid) { errors.push(invalid); continue }
      const src = URL.createObjectURL(file)
      urls.current.add(src)
      try {
        const image = new Image()
        image.src = src
        await image.decode()
        if (!mounted.current) { URL.revokeObjectURL(src); urls.current.delete(src); continue }
        added.push({ id: randomId(), src, name: file.name || 'Скріншот', ratio: image.naturalWidth / image.naturalHeight, x: .05, y: 18 + (photos.length + added.length) * 24, width: .5 })
      } catch {
        URL.revokeObjectURL(src)
        urls.current.delete(src)
        errors.push('Не вдалося відкрити фото. Спробуйте інший файл.')
      }
    }
    if (mounted.current) {
      setPhotos((current) => [...current, ...added])
      setError([...new Set(errors)].join(' '))
      setBusy(false)
    }
    loading.current = false
  }

  function remove(id: string) {
    const photo = photos.find((entry) => entry.id === id)
    if (photo) { URL.revokeObjectURL(photo.src); urls.current.delete(photo.src) }
    setPhotos((current) => current.filter((entry) => entry.id !== id))
    setError('')
  }

  return { photos, error, busy, add, remove,
    update: (id: string, value: Partial<Pick<ShowcasePhoto, 'x' | 'y' | 'width'>>) => setPhotos((current) => current.map((photo) => photo.id === id ? { ...photo, ...value } : photo)),
    // A sent comment keeps owning these URLs until the gallery example unmounts.
    clearDraft: () => { setPhotos([]); setError('') },
  }
}

export type ShowcasePhotoDraft = ReturnType<typeof useShowcasePhotos>
