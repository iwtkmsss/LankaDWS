export const MAX_TEXT_PREVIEW_BYTES = 1024 * 1024
const TEXT_FILE_FORMATS = new Map([
  ['text/plain', 'TXT'], ['text/csv', 'CSV'], ['application/json', 'JSON'],
  ['application/xml', 'XML'], ['text/xml', 'XML'],
])
const OFFICE_FILE_FORMATS = new Map<string, 'word' | 'excel' | 'powerpoint'>([
  ['application/msword', 'word'], ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'word'],
  ['application/vnd.ms-excel', 'excel'], ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'excel'],
  ['application/vnd.ms-powerpoint', 'powerpoint'], ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'powerpoint'],
])

export function officeFileFormat(mimeType: string | null): 'word' | 'excel' | 'powerpoint' | null {
  return OFFICE_FILE_FORMATS.get(normalizedFileMime(mimeType)) ?? null
}

export function normalizedFileMime(mimeType: string | null): string {
  return mimeType?.split(';')[0].trim().toLowerCase() ?? ''
}

export function isPreviewableImage(mimeType: string | null): boolean {
  return /^image\/(?:png|jpeg|gif|webp)$/.test(normalizedFileMime(mimeType))
}

export function textFileFormat(mimeType: string | null): string | null {
  return TEXT_FILE_FORMATS.get(normalizedFileMime(mimeType)) ?? null
}

export function isTextPreview(mimeType: string | null): boolean {
  return textFileFormat(mimeType) !== null
}
