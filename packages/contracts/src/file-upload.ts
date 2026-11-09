export const MAX_FILE_UPLOAD_BYTES = 100 * 1024 * 1024

/** Office formats the server converts to PDF for in-app preview (LibreOffice). */
export const OFFICE_PREVIEW_MIME_TYPES = [
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf', 'text/rtf',
] as const
/** Larger Office files are offered for download only, so one preview cannot tie up the converter. */
export const OFFICE_PREVIEW_MAX_BYTES = 30 * 1024 * 1024

export function isOfficePreviewMime(mimeType: string | null | undefined): boolean {
  const mime = mimeType?.split(';')[0]?.trim().toLowerCase() ?? ''
  return (OFFICE_PREVIEW_MIME_TYPES as readonly string[]).includes(mime)
}

export const FILE_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf', 'text/rtf', 'text/plain', 'text/csv', 'application/json', 'application/xml',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'application/zip', 'application/x-rar-compressed', 'application/vnd.rar',
  'application/x-7z-compressed', 'application/x-tar', 'application/gzip',
  'application/x-bzip2', 'application/x-xz',
] as const

export const FILE_UPLOAD_FORMATS_MESSAGE = 'Доступні формати: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, ODT, ODS, ODP, RTF, TXT, CSV, JSON, XML, PNG, JPG, WEBP, GIF; АРХІВИ (до 100 Мб).'
export const FILE_UPLOAD_SIZE_MESSAGE = 'Розмір файлу завеликий. Максимальний розмір — 100 МБ.'
