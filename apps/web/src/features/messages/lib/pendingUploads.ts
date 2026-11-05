import { useSyncExternalStore } from 'react'

export interface PendingUpload {
  id: string
  threadId: string
  file: File
  loaded: number
  phase: 'queued' | 'uploading' | 'processing' | 'sending'
  cancel: () => void
}
let snapshot: PendingUpload[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
export function addPendingUploads(items: PendingUpload[]) {
  if (!items.length) return
  snapshot = [...snapshot, ...items]
  emit()
}
export function updatePendingUpload(id: string, patch: Partial<PendingUpload>) {
  snapshot = snapshot.map((item) => item.id === id ? { ...item, ...patch } : item)
  emit()
}
export function removePendingUploads(ids: string[]) {
  if (!ids.length) return
  snapshot = snapshot.filter((item) => !ids.includes(item.id))
  emit()
}
export function usePendingUploads() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => snapshot)
}
