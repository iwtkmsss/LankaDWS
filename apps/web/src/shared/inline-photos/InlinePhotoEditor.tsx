import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { Move, X } from 'lucide-react'
import { IconButton } from '../ui'
import { fitPhoto, rectToPlacement, resizePhoto, type InlinePhoto, type PhotoBounds, type PhotoRect } from './inlinePhotos'
import './inline-photos.css'

const resizeCorners = [
  ['top-left', 'зверху ліворуч'], ['top-right', 'зверху праворуч'],
  ['bottom-left', 'знизу ліворуч'], ['bottom-right', 'знизу праворуч'],
] as const

type Placement = Partial<Pick<InlinePhoto, 'x' | 'y' | 'width'>>

/** Overlays draggable, resizable photos on the rich text editor rendered as `children`. */
export function InlinePhotoEditor({ photos, onUpdate, onRemove, disabled, children }: {
  photos: InlinePhoto[]
  onUpdate: (id: string, placement: Placement) => void
  onRemove: (id: string) => void
  disabled?: boolean
  children: ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
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

  function place(id: string, rect: PhotoRect, ratio: number) {
    const placement = rectToPlacement(rect, bounds)
    onUpdate(id, rectToPlacement(fitPhoto({ ...placement, ratio }, bounds), bounds))
  }
  function start(event: PointerEvent<HTMLElement>, photo: InlinePhoto, corner: string | null) {
    if (disabled || event.button !== 0) return
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
    place(active.id, active.corner ? resizePhoto(active.rect, active.ratio, bounds, active.corner, dx, dy) : { ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy }, active.ratio)
  }
  function finish(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const current = photos.find((photo) => photo.id === selected)
  const currentWidth = current && bounds.width ? Math.round(fitPhoto(current, bounds).width / bounds.width * 100) : 10
  return <div className="inline-photos-editor">
    <div ref={root} className={`inline-photos-editor__canvas${photos.length ? ' has-photos' : ''}`} onPointerDown={() => setSelected(null)}>
      {children}
      <div className="inline-photos-editor__images" style={{ top: bounds.top, left: bounds.left, width: bounds.width, height: bounds.height }}>
        {photos.map((photo) => {
          const rect = fitPhoto(photo, bounds)
          return <div key={photo.id} className={`inline-photos-photo${selected === photo.id ? ' is-selected' : ''}`} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}>
            <button type="button" className="inline-photos-photo__move" disabled={disabled} aria-label={`Перемістити ${photo.name}`} onFocus={() => setSelected(photo.id)} onPointerDown={(event) => start(event, photo, null)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null }} onKeyDown={(event) => {
              if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); onRemove(photo.id); return }
              if (event.key === 'Escape') { event.preventDefault(); setSelected(null); root.current?.querySelector<HTMLElement>('.rich-editor__input')?.focus(); return }
              const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key]
              if (!direction || !bounds.width) return
              event.preventDefault()
              const step = event.shiftKey ? 10 : 2
              place(photo.id, { ...rect, x: rect.x + direction[0]! * step, y: rect.y + direction[1]! * step }, photo.ratio)
            }}><img src={photo.src} alt={photo.name} draggable={false} /></button>
            {selected === photo.id && resizeCorners.map(([corner, label]) => <button key={corner} type="button" className={`inline-photos-photo__handle is-${corner}`} aria-label={`Змінити розмір ${photo.name}: ${label}`} disabled={disabled} onPointerDown={(event) => start(event, photo, corner)} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null }} onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) || !bounds.width) return
              event.preventDefault()
              const delta = ['ArrowRight', 'ArrowUp'].includes(event.key) ? 8 : -8
              place(photo.id, resizePhoto(rect, photo.ratio, bounds, corner, corner.includes('left') ? -delta : delta, 0), photo.ratio)
            }} />)}
            {selected === photo.id && <IconButton className="inline-photos-editor__remove" label="Прибрати вибране фото" disabled={disabled} onPointerDown={(event) => event.stopPropagation()} onClick={() => { onRemove(photo.id); setSelected(null) }}><X size={12} /></IconButton>}
          </div>
        })}
      </div>
    </div>
    {current && <label className="inline-photos-size">Ширина фото<input type="range" min={Math.min(currentWidth, Math.ceil(64 / Math.max(1, bounds.width) * 100))} max="100" value={currentWidth} disabled={disabled} onChange={(event) => {
      const rect = fitPhoto(current, bounds)
      place(current.id, { ...rect, width: Number(event.target.value) / 100 * bounds.width }, current.ratio)
    }} /><span>{currentWidth}%</span></label>}
    {photos.length > 0 && <p className="inline-photos-hint"><Move size={14} />Перетягуйте фото в межах тексту. Розмір — за кути або повзунком. Стрілки — переміщення, Delete — прибрати.</p>}
  </div>
}
