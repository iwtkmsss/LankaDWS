import { normalizedFileMime, officeFileFormat, textFileFormat } from './filePreview'

const EXTENSION_FORMATS: Record<string, string> = {
  pdf: 'pdf', doc: 'word', docx: 'word', docm: 'word', odt: 'word', rtf: 'word',
  xls: 'excel', xlsx: 'excel', xlsm: 'excel', xlsb: 'excel', ods: 'excel',
  ppt: 'powerpoint', pptx: 'powerpoint', pptm: 'powerpoint', odp: 'powerpoint',
  txt: 'TXT', csv: 'CSV', json: 'JSON', xml: 'XML',
}

/** Visual classification only; never use filename hints to allow content previews. */
export function fileFormat(mimeType: string | null, fileName = '', fileType?: string): string {
  const mime = normalizedFileMime(mimeType)
  const extension = fileName.match(/\.([a-z\d]+)$/i)?.[1].toLowerCase() ?? ''
  if (mime === 'application/pdf') return 'pdf'
  const office = officeFileFormat(mime)
  if (office) return office
  if (mime === 'application/vnd.oasis.opendocument.text' || /^(?:application|text)\/rtf$/.test(mime)) return 'word'
  if (mime === 'application/vnd.oasis.opendocument.spreadsheet') return 'excel'
  if (mime === 'application/vnd.oasis.opendocument.presentation') return 'powerpoint'
  if (mime.startsWith('image/')) return 'image'
  if (/^application\/(?:zip|x-zip(?:-compressed)?|(?:x-)?rar(?:-compressed)?|vnd\.rar|x-7z-compressed|(?:x-)?tar|(?:x-)?gzip|x-bzip2?|x-xz|x-compressed|x-compress|x-archive)$/.test(mime)) return 'archive'
  const text = textFileFormat(mime)
  if (text) return text
  if (/^(?:png|jpe?g|gif|webp|svg|bmp|avif|heic|heif|tiff?|ico)$/.test(extension)) return 'image'
  if (/^(?:zip|rar|7z|tar|gz|tgz|bz2?|tbz2?|xz|txz|z)$/.test(extension)) return 'archive'
  if (Object.hasOwn(EXTENSION_FORMATS, extension)) return EXTENSION_FORMATS[extension]
  if (fileType === 'IMAGE') return 'image'
  if (fileType === 'PDF') return 'pdf'
  return 'file'
}
