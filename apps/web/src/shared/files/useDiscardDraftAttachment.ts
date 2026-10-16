import { useRef, useState } from 'react'
import { api } from '../api/client'

export function useDiscardDraftAttachment(onRemoved: (id: string) => void) {
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function discard(id: string) {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      await api(`/files/${encodeURIComponent(id)}/draft`, { method: 'DELETE' })
      onRemoved(id)
    } catch {
      setError('Не вдалося прибрати файл. Спробуйте ще раз.')
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }
  return { discard, pending, error, isPending: () => inFlight.current }
}
