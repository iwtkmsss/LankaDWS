import { ResizeHandle } from '../../shared/ui/ResizeHandle'
import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react'
import { ImagePlus, Move, X } from 'lucide-react'
import { IconButton } from '../../shared/ui'
import { RichTextEditor } from '../../shared/text/RichTextEditor'
import { fitPhoto, resizePhoto, SHOWCASE_PHOTO_ACCEPT, SHOWCASE_PHOTO_LIMIT, type PhotoBounds, type PhotoRect, type ShowcasePhoto, type ShowcasePhotoDraft } from './showcasePhotos'
import './showcase-photos.css'

const resizeCorners = [
  ['top-left', 'зверху ліворуч'], ['top-right', 'зверху праворуч'],
  ['bottom-left', 'знизу ліворуч'], ['bottom-right', 'знизу праворуч'],
] as const

export function ShowcasePublicationEditor({ id, value, onChange, photos, disabled }: {
  id: string; value: string; onChange: (value: string) => void; photos: ShowcasePhotoDraft; disabled?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [bounds, setBounds] = useState<PhotoBounds & { top: number; left: number }>({ width: 0, height: 0, top: 0, left: 0 })
  const [selected, setSelected] = useState<string | null>(null)
  const drag = useRef<{ id: string; corner: string | null; startX: number; startY: number; rect: PhotoRect; ratio: number; pointerId: number } | null>(null)
  useLayoutEffect(() => {
    const editor = root.current?.querySelector<HTMLElement>('.rich-editor__input')
    if (!editor) return
    function measure() {
      const wrapperRect = root.current!.getBoundingClientRect(), rect = editor!.getBoundingClientRect()
      setBounds({ width: editor!.clientWidth, height: editor!.clientHeight, top: rect.top - wrapperRect.top + editor!.clientTop, left: rect.left - wrapperRect.left + editor!.clientLeft })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(editor)
    observer.observe(root.current!)
    measure()
    return () => observer.disconnect()
  }, [])

  function start(event: PointerEvent<HTMLElement>, photo: ShowcasePhoto, corner: string | null) {
    if (disabled || photos.busy || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    setSelected(photo.id)
    drag.current = { id: photo.id, corner, startX: event.clientX, startY: event.clientY, rect: fitPhoto(photo, bounds), ratio: photo.ratio, pointerId: event.pointerId }
  }
  function move(event: PointerEvent<HTMLElement>) {
    const active = drag.current
    if (!active || event.pointerId !== active.pointerId || !bounds.width) return
    const dx = event.clientX - active.startX, dy = event.clientY - active.startY
    const rect = active.corner ? resizePhoto(active.rect, active.ratio, bounds, active.corner, dx, dy) : { ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy }
    const next = fitPhoto({ x: rect.x / bounds.width, y: rect.y, width: rect.width / bounds.width, ratio: active.ratio }, bounds)
    photos.update(active.id, { x: next.x / bounds.width, y: next.y, width: next.width / bounds.width })
  }
  function finish(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const current = photos.photos.find((photo) => photo.id === selected)
  const currentWidth = current && bounds.width ? Math.round(fitPhoto(current, bounds).width / bounds.width * 100) : 10
  const busy = disabled || photos.busy
  return <div className="showcase-publication-editor">
    <input ref={input} type="file" hidden multiple accept={SHOWCASE_PHOTO_ACCEPT} disabled={busy} aria-label="Фото в текст публікації" onChange={(event) => { void photos.add(Array.from(event.target.files ?? [])); event.target.value = '' }} />
    <div ref={root} className={`showcase-publication-editor__canvas${photos.photos.length ? ' has-photos' : ''}`} onPointerDown={() => setSelected(null)}>
      <RichTextEditor id={id} label="Текст публікації" rows={5} value={value} onChange={onChange} placeholder="Поділіться важливим оновленням…" maxLength={10000} disabled={busy} toolbarActions={<>
        <button type="button" className="showcase-publication-editor__insert-photo" aria-label={photos.busy ? 'Додаємо фото…' : 'Вставити фото'} title="Вставити фото · до 5 фото · до 10 МБ" disabled={busy || photos.photos.length >= SHOWCASE_PHOTO_LIMIT} onClick={() => input.current?.click()}><ImagePlus size={16} /><span>{photos.busy ? 'Додаємо фото…' : 'Вставити фото'}</span></button>
      </>} onPaste={(event) => {
        const files = Array.from(event.clipboardData.files)
        if (files.length) { event.preventDefault(); void photos.add(files) }
      }} />
      <div className="showcase-publication-editor__images" style={{ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height }}>
        {photos.photos.map((photo) => {
          const rect = fitPhoto(photo, bounds)
          return <div key={photo.id} className={`showcase-inline-photo${selected === photo.id ? ' is-selected' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
            <button type="button" className="showcase-inline-photo__move" disabled={busy} aria-label={`Перемістити ${photo.name}`} onFocus={() => setSelected(photo.id)} onPointerDown={(event) => start(event, photo, null)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null }} onKeyDown={(event) => {
              if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); photos.remove(photo.id); return }
              if (event.key === 'Escape') { event.preventDefault(); setSelected(null); root.current?.querySelector<HTMLElement>('.rich-editor__input')?.focus(); return }
              const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
              if (!direction || !bounds.width) return
              event.preventDefault()
              const step = event.shiftKey ? 10 : 2
              const next = fitPhoto({ ...photo, x: (rect.x + direction[0]! * step) / bounds.width, y: rect.y + direction[1]! * step }, bounds)
              photos.update(photo.id, { x: next.x / bounds.width, y: next.y })
            }}><img src={photo.src} alt={photo.name} draggable={false} /></button>
            {selected === photo.id && resizeCorners.map(([corner, label]) => <button key={corner} type="button" className={`showcase-inline-photo__handle is-${corner}`} aria-label={`Змінити розмір ${photo.name}: ${label}`} disabled={busy} onPointerDown={(event) => start(event, photo, corner)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null }} onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !bounds.width) return
              event.preventDefault()
              const delta = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 8 : -8
              const next = resizePhoto(rect, photo.ratio, bounds, corner, corner.includes('left') ? -delta : delta, 0)
              photos.update(photo.id, { x: next.x / bounds.width, y: next.y, width: next.width / bounds.width })
            }} />)}
            {selected === photo.id && <IconButton className="showcase-publication-editor__remove" label="Прибрати вибране фото" disabled={busy} onPointerDown={(event) => event.stopPropagation()} onClick={() => { photos.remove(photo.id); setSelected(null) }}><X size={12} /></IconButton>}
          </div>
        })}
      </div>
      <ResizeHandle targetRef={root} selector=".rich-editor__input" controls={id} label="Змінити висоту редактора" disabled={busy} />
    </div>
    {current && <label className="showcase-photo-size">Ширина фото<input type="range" min={Math.min(currentWidth, Math.ceil(64 / Math.max(1, bounds.width) * 100))} max="100" value={currentWidth} disabled={busy} onChange={(event) => photos.update(current.id, { width: Number(event.target.value) / 100 })} /><span>{currentWidth}%</span></label>}
    {photos.photos.length > 0 && <p className="showcase-photo-hint"><Move size={14} />Перетягуйте фото в межах тексту. Розмір — за кути або повзунком. Стрілки — переміщення, Delete — прибрати.</p>}
    {photos.error && <p className="showcase-photo-error" role="alert">{photos.error}</p>}
  </div>
}
