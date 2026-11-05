import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileDropzone } from './FileDropzone'

function fileDrag(files: File[]) {
  return { dataTransfer: { files, items: files, types: ['Files'] } }
}

describe('FileDropzone', () => {
  it('shows the drop hint while a file drag is over the zone', () => {
    render(<FileDropzone label="Додати файли" multiple title="Перетягніть файли сюди" />)
    const zone = screen.getByLabelText('Додати файли').closest('label')!

    fireEvent.dragEnter(zone, fileDrag([new File(['a'], 'a.pdf', { type: 'application/pdf' })]))
    expect(screen.getByText('Відпустіть файли тут')).toBeVisible()

    fireEvent.dragLeave(zone, fileDrag([new File(['a'], 'a.pdf', { type: 'application/pdf' })]))
    expect(screen.getByText('Перетягніть файли сюди')).toBeVisible()
  })

  it('reports dropped files that match the accepted formats', () => {
    const onFiles = vi.fn()
    render(<FileDropzone label="Файл документа" accept=".pdf" onFiles={onFiles} />)
    const zone = screen.getByLabelText('Файл документа').closest('label')!
    const pdf = new File(['a'], 'report.pdf', { type: 'application/pdf' })

    fireEvent.drop(zone, fileDrag([pdf, new File(['b'], 'notes.txt', { type: 'text/plain' })]))

    expect(onFiles).toHaveBeenCalledWith([pdf])
  })

  it('explains a drop that contains only unsupported formats', () => {
    const onFiles = vi.fn()
    render(<FileDropzone label="Файл документа" accept=".pdf" onFiles={onFiles} />)
    const zone = screen.getByLabelText('Файл документа').closest('label')!

    fireEvent.drop(zone, fileDrag([new File(['b'], 'notes.txt', { type: 'text/plain' })]))

    expect(onFiles).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Такий формат файлу не підтримується.')
  })

  it('keeps the native picker reachable through its accessible name', () => {
    const onFiles = vi.fn()
    render(<FileDropzone label="Додати файли" multiple onFiles={onFiles} />)
    const file = new File(['a'], 'guide.pdf', { type: 'application/pdf' })

    fireEvent.change(screen.getByLabelText('Додати файли'), { target: { files: [file] } })

    expect(onFiles).toHaveBeenCalledWith([file])
  })
})
