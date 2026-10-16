import type {
  ChatAttachmentView,
  DriveFileItem,
  DriveFolderItem,
  DriveListQuery,
  DriveListResult,
  DriveOwnersResult,
  DriveDestinationsResult,
  DrivePickerResult,
  DriveShareRole,
  DriveShareTargetType,
  DriveShareView,
} from '@lankadws/contracts'
import { api, jsonBody } from '../../shared/api/client'

export type DriveItem =
  | ({ kind: 'FOLDER' } & DriveFolderItem)
  | ({ kind: 'FILE' } & DriveFileItem)

export type ChatAttachmentLike = ChatAttachmentView

export type DriveQueryInput = Partial<DriveListQuery>

export function driveQueryString(query: DriveQueryInput): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  return params.toString()
}

export function fetchDrive(query: DriveQueryInput): Promise<DriveListResult> {
  const qs = driveQueryString(query)
  return api<DriveListResult>(`/drive${qs ? `?${qs}` : ''}`)
}

export function fetchDriveOwners(search: string, cursor?: string, signal?: AbortSignal): Promise<DriveOwnersResult> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (cursor) params.set('cursor', cursor)
  return api<DriveOwnersResult>(`/drive/owners?${params}`, { signal })
}

export function fetchMoveDestinations(targetType: 'DOCUMENT' | 'FOLDER', targetId: string, folderId?: string, cursor?: string, signal?: AbortSignal): Promise<DriveDestinationsResult> {
  const params = new URLSearchParams({ targetType, targetId })
  if (folderId) params.set('folderId', folderId)
  if (cursor) params.set('cursor', cursor)
  return api<DriveDestinationsResult>(`/drive/destinations?${params}`, { signal })
}

export function fetchDrivePicker(search: string, cursor?: string, signal?: AbortSignal, folderId?: string): Promise<DrivePickerResult> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (cursor) params.set('cursor', cursor)
  if (folderId) params.set('folderId', folderId)
  return api<DrivePickerResult>(`/drive/picker?${params}`, { signal })
}

export function createFolder(input: { name: string; parentId?: string | null }) {
  return api<DriveFolderItem>('/drive/folders', { method: 'POST', body: jsonBody(input) })
}

export function renameFolder(folderId: string, name: string) {
  return api<DriveFolderItem>(`/drive/folders/${encodeURIComponent(folderId)}`, {
    method: 'PATCH',
    body: jsonBody({ name }),
  })
}

export function moveFolder(folderId: string, parentId: string | null) {
  return api<DriveFolderItem>(`/drive/folders/${encodeURIComponent(folderId)}/move`, {
    method: 'POST',
    body: jsonBody({ parentId }),
  })
}

export function trashFolder(folderId: string) {
  return api<{ trashed: boolean }>(`/drive/folders/${encodeURIComponent(folderId)}/trash`, { method: 'POST' })
}

export function restoreFolder(folderId: string) {
  return api<{ restored: boolean }>(`/drive/folders/${encodeURIComponent(folderId)}/restore`, { method: 'POST' })
}

export function renameDocument(documentId: string, name: string, expectedVersion: number) {
  return api<{ version: number }>(`/drive/documents/${encodeURIComponent(documentId)}/rename`, {
    method: 'POST',
    body: jsonBody({ name, expectedVersion }),
  })
}

export function moveDocument(documentId: string, folderId: string | null, expectedVersion: number) {
  return api<{ version: number }>(`/drive/documents/${encodeURIComponent(documentId)}/move`, {
    method: 'POST',
    body: jsonBody({ folderId, expectedVersion }),
  })
}

export function trashDocument(documentId: string, expectedVersion: number) {
  return api<{ archived: boolean }>(`/documents/${encodeURIComponent(documentId)}/archive`, {
    method: 'POST',
    body: jsonBody({ expectedVersion }),
  })
}

export function restoreDocument(documentId: string, expectedVersion: number) {
  return api<{ restored: boolean }>(`/documents/${encodeURIComponent(documentId)}/restore`, {
    method: 'POST',
    body: jsonBody({ expectedVersion }),
  })
}

export function listShares(targetType: DriveShareTargetType, targetId: string) {
  return api<DriveShareView[]>(`/drive/shares?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`)
}

export function createShare(input: {
  targetType: DriveShareTargetType
  targetId: string
  principalType: 'USER' | 'GROUP'
  principalId: string
  role: DriveShareRole
}) {
  return api<DriveShareView[]>('/drive/shares', { method: 'POST', body: jsonBody(input) })
}

export function revokeShare(shareId: string) {
  return api<DriveShareView[]>(`/drive/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' })
}

/** Saves a file the user can already see (e.g. a chat attachment) onto their Drive. */
export function importFileToDrive(input: { fileId: string; name?: string; folderId?: string | null }) {
  return api<{ id: string; name: string }>('/drive/import-file', { method: 'POST', body: jsonBody(input) })
}

/** Copies a Drive document's current file so it can be sent as a chat attachment. */
export function driveDocumentAsAttachment(documentId: string) {
  return api<ChatAttachmentLike>(`/drive/documents/${encodeURIComponent(documentId)}/as-attachment`, { method: 'POST' })
}

export async function uploadToDrive(file: File, folderId: string | null): Promise<string> {
  const form = new FormData()
  form.set('file', file)
  const uploaded = await api<{ id: string; scanStatus: string }>(
    '/files',
    { method: 'POST', body: form },
  )
  let scanStatus = uploaded.scanStatus
  for (let attempt = 0; attempt < 10 && scanStatus !== 'CLEAN'; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 600))
    scanStatus = (await api<{ scanStatus: string }>(`/files/${uploaded.id}/status`)).scanStatus
  }
  if (scanStatus !== 'CLEAN') throw new Error('scan')
  const created = await api<{ id: string }>('/documents', {
    method: 'POST',
    body: jsonBody({ name: file.name.replace(/\.[^/.]+$/, ''), fileId: uploaded.id }),
  })
  if (folderId) await moveDocument(created.id, folderId, 1)
  return created.id
}
