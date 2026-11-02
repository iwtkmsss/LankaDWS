import { FILE_UPLOAD_FORMATS_MESSAGE, FILE_UPLOAD_MIME_TYPES, FILE_UPLOAD_SIZE_MESSAGE, MAX_FILE_UPLOAD_BYTES } from '@lankadws/contracts'

const extensions = new Set('pdf doc docx xls xlsx ppt pptx odt ods odp rtf txt csv json xml png jpg jpeg webp gif zip rar 7z tar gz tgz bz2 tbz tbz2 xz txz'.split(' '))
const mimeTypes = new Set<string>(FILE_UPLOAD_MIME_TYPES)

export function fileSelectionError(file: File): string | null {
  if (file.size === 0) return 'Файл порожній. Оберіть файл із вмістом.'
  if (file.size > MAX_FILE_UPLOAD_BYTES) return FILE_UPLOAD_SIZE_MESSAGE
  const extension = file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase()
  // Browser MIME values are inconsistent for Office and archive files. The server
  // still detects the actual content; filename checks here are early feedback.
  if (extension ? !extensions.has(extension) : !mimeTypes.has(file.type.toLowerCase())) return FILE_UPLOAD_FORMATS_MESSAGE
  return null
}

export function showFileError(message: string): void {
  window.dispatchEvent(new CustomEvent('lankadws:file-error', { detail: message }))
}

export function validMessageFiles(files: File[]): File[] {
  return files.filter((file) => {
    const error = fileSelectionError(file)
    if (error) showFileError(`${file.name}: ${error}`)
    return !error
  })
}
