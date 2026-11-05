import { useContext, useRef, useState } from 'react'
import { QueryClientContext } from '@tanstack/react-query'
import { Check, HardDrive, LoaderCircle } from 'lucide-react'
import { importFileToDrive } from '../../features/drive/api'

export function SaveToDriveButton({ fileId, fileName, className = 'button button--secondary', iconOnly = false }: {
  fileId: string
  fileName: string
  className?: string
  iconOnly?: boolean
}) {
  const queryClient = useContext(QueryClientContext)
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const saving = useRef(false)
  const label = status === 'busy' ? 'Зберігаємо…'
    : status === 'done' ? 'Збережено на Диск'
    : status === 'error' ? 'Не вдалося зберегти. Повторити'
    : 'Зберегти на Диск'

  async function save() {
    if (saving.current) return
    saving.current = true
    setStatus('busy')
    try {
      await importFileToDrive({ fileId, name: fileName.replace(/\.[^/.]+$/, '') })
      setStatus('done')
      void queryClient?.invalidateQueries({ queryKey: ['drive'] })
    } catch {
      saving.current = false
      setStatus('error')
    }
  }

  return <button type="button" className={className} disabled={status === 'busy' || status === 'done'}
    onClick={() => void save()} title={label} aria-label={iconOnly ? label : undefined}>
    {status === 'busy' ? <LoaderCircle size={17} className="is-spinning" aria-hidden />
      : status === 'done' ? <Check size={17} aria-hidden /> : <HardDrive size={17} aria-hidden />}
    <span className={iconOnly ? 'sr-only' : undefined} aria-live="polite">{label}</span>
  </button>
}
