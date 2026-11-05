import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FileThumbnail } from './FileThumbnail'
import { FileFormatIcon } from './FileFormatIcon'

const file = { id: 'file-1', fileName: 'attachment', mimeType: 'image/png', scanStatus: 'CLEAN' }

describe('shared file thumbnails', () => {
  it.each([
    ['photo.png', null, 'PNG', 'image'],
    ['photo.jpg', null, 'JPG', 'image'],
    ['attachment', 'image/webp', 'WEBP', 'image'],
    ['backup.zip', null, 'ZIP', 'archive'],
    ['backup.rar', null, 'RAR', 'archive'],
    ['attachment', 'application/x-7z-compressed', '7Z', 'archive'],
  ])('labels %s (%s) as %s with its shared category icon', (fileName, mimeType, label, icon) => {
    const { container } = render(<FileFormatIcon fileName={fileName} mimeType={mimeType} />)
    expect(screen.getByText(label)).toBeVisible()
    expect(container.querySelector(`svg.lucide-${icon}`)).not.toBeNull()
  })

  it.each([null, '', 'application/octet-stream'])('uses the shared PDF icon for a .PDF filename with MIME %s', (mimeType) => {
    render(<FileFormatIcon mimeType={mimeType} fileName="Звіт.PDF" size={18} />)
    expect(screen.getByRole('img', { name: 'Формат PDF' })).toHaveClass('file-format-icon--pdf')
  })

  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])('shows an actual thumbnail for %s', (mimeType) => {
    render(<FileThumbnail file={{ ...file, mimeType }} />)
    expect(screen.getByRole('img', { name: 'attachment' })).toHaveAttribute('src', '/api/v1/files/file-1/download?inline=true')
  })

  it.each([
    ['application/pdf', 'PDF'], ['text/plain; charset=utf-8', 'TXT'], ['text/csv', 'CSV'],
    ['application/json', 'JSON'], ['application/xml', 'XML'],
  ])('identifies %s without loading file contents', (mimeType, label) => {
    const { container } = render(<FileThumbnail file={{ ...file, mimeType }} />)
    expect(screen.getByRole('img', { name: `Формат ${label}` })).toBeVisible()
    expect(container.querySelector('img, iframe')).toBeNull()
  })

  it.each([
    ['application/msword', 'Word'], ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'Word'],
    ['application/vnd.ms-excel', 'Excel'], ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Excel'],
    ['application/vnd.ms-powerpoint', 'PowerPoint'], ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'PowerPoint'],
  ])('identifies Microsoft %s with its format icon', (mimeType, name) => {
    const { container } = render(<FileThumbnail file={{ ...file, mimeType }} />)
    expect(screen.getByRole('img', { name: `Формат ${name}` })).toHaveClass('file-format-icon--office')
    expect(container.querySelector('img, iframe')).toBeNull()
  })

  it('keeps an unknown format as a generic file', () => {
    const mimeType = 'application/octet-stream'
    const { container } = render(<FileThumbnail file={{ ...file, mimeType }} />)
    expect(screen.getByRole('img', { name: 'Файл' })).toBeVisible()
    expect(container.querySelector('img')).toBeNull()
  })

  it.each(['image/svg+xml', 'image/avif', 'image/heic'])('identifies %s without loading an unsupported preview', (mimeType) => {
    const { container } = render(<FileThumbnail file={{ ...file, mimeType }} />)
    expect(screen.getByRole('img', { name: 'Зображення' })).toHaveClass('file-format-icon--image')
    expect(container.querySelector('img')).toBeNull()
  })

  it.each([
    ['application/zip', 'attachment'], ['application/x-zip-compressed', 'attachment'],
    ['application/vnd.rar', 'attachment'], ['application/x-7z-compressed', 'attachment'],
    ['application/x-tar', 'attachment'], ['application/gzip', 'attachment'],
    ['application/x-bzip2', 'attachment'], ['application/x-xz', 'attachment'],
    [null, 'backup.ZIP'], ['', 'backup.7z'], ['application/octet-stream', 'backup.tar.gz'],
  ])('identifies an archive with MIME %s and filename %s', (mimeType, fileName) => {
    const { container } = render(<FileThumbnail file={{ ...file, mimeType, fileName }} />)
    expect(screen.getByRole('img', { name: 'Архів' })).toHaveClass('file-format-icon--archive')
    expect(container.querySelector('img')).toBeNull()
  })

  it.each([
    ['photo.PNG', 'Зображення', 'image'], ['notes.TXT', 'Формат TXT', 'text'],
    ['report.docx', 'Формат Word', 'office'], ['budget.xlsx', 'Формат Excel', 'office'],
    ['slides.pptx', 'Формат PowerPoint', 'office'],
  ])('uses filename hints for %s without allowing a content preview', (fileName, label, kind) => {
    const { container } = render(<FileThumbnail file={{ ...file, mimeType: 'application/octet-stream', fileName }} />)
    expect(screen.getByRole('img', { name: label })).toHaveClass(`file-format-icon--${kind}`)
    expect(container.querySelector('img')).toBeNull()
  })

  it.each(['SCANNING', 'QUARANTINED', 'INFECTED'])('does not load an image while %s', (scanStatus) => {
    const { container } = render(<FileThumbnail file={{ ...file, scanStatus }} />)
    expect(container.querySelector('img')).toBeNull()
  })

  it('replaces a failed photo with an icon and retries when the file changes', () => {
    const view = render(<FileThumbnail file={file} />)
    fireEvent.error(screen.getByRole('img', { name: 'attachment' }))
    expect(screen.queryByRole('img', { name: 'attachment' })).toBeNull()
    view.rerender(<FileThumbnail file={{ ...file, id: 'another-file' }} />)
    expect(screen.getByRole('img', { name: 'attachment' })).toHaveAttribute('src', '/api/v1/files/another-file/download?inline=true')
  })
})
