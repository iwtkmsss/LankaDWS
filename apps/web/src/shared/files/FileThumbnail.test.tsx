import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FileThumbnail } from './FileThumbnail'

const file = { id: 'file-1', fileName: 'attachment', mimeType: 'image/png', scanStatus: 'CLEAN' }

describe('shared file thumbnails', () => {
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

  it.each(['image/svg+xml', 'image/avif', 'application/zip'])('keeps %s as a generic file', (mimeType) => {
    const { container } = render(<FileThumbnail file={{ ...file, mimeType }} />)
    expect(screen.getByRole('img', { name: 'Файл' })).toBeVisible()
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
