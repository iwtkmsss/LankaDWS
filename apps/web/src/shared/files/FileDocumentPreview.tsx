import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, FileText, LoaderCircle } from 'lucide-react'
import { IconButton } from '../ui'
import { MAX_TEXT_PREVIEW_BYTES } from './filePreview'

class TextTooLarge extends Error {}

async function readPreviewText(response: Response): Promise<string> {
  if (Number(response.headers.get('content-length')) > MAX_TEXT_PREVIEW_BYTES) {
    await response.body?.cancel()
    throw new TextTooLarge()
  }
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_TEXT_PREVIEW_BYTES) throw new TextTooLarge()
      text += decoder.decode(chunk.value, { stream: true })
    }
    return text + decoder.decode()
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
}

type PreviewState =
  | { status: 'loading' | 'error' | 'too-large' }
  | { status: 'ready'; content: string }

export function FileDocumentPreview({ kind, fileName, downloadUrl, headerActionsTarget }: {
  kind: 'text' | 'pdf'
  fileName: string
  downloadUrl: string
  headerActionsTarget: HTMLElement | null
}) {
  const [state, setState] = useState<PreviewState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [copyStatus, setCopyStatus] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    setState({ status: 'loading' })
    setCopyStatus('')
    async function load() {
      try {
        const response = await fetch(downloadUrl, { credentials: 'include', signal: controller.signal })
        if (!response.ok) throw new Error('File unavailable')
        let content: string
        if (kind === 'text') {
          content = await readPreviewText(response)
        } else {
          const bytes = await response.arrayBuffer()
          if (controller.signal.aborted) return
          // The authenticated response forbids framing. A local PDF URL keeps that policy intact.
          objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
          content = objectUrl
        }
        if (!controller.signal.aborted) setState({ status: 'ready', content })
      } catch (error) {
        if (!controller.signal.aborted) setState({ status: error instanceof TextTooLarge ? 'too-large' : 'error' })
      }
    }
    void load()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [downloadUrl, kind, attempt])

  async function copyText() {
    if (state.status !== 'ready') return
    try {
      await navigator.clipboard.writeText(state.content)
      setCopyStatus('Текст скопійовано')
    } catch {
      setCopyStatus('Не вдалося скопіювати. Виділіть текст і скопіюйте вручну.')
    }
  }

  return <div className="file-preview-modal__document">
    {kind === 'text' && headerActionsTarget && createPortal(
      <IconButton label="Копіювати" title="Копіювати текст" disabled={state.status !== 'ready'} onClick={() => void copyText()}>
        <Copy size={18} aria-hidden />
      </IconButton>, headerActionsTarget,
    )}
    {state.status === 'loading' ? <div className="file-preview-modal__notice" role="status">
      <LoaderCircle size={28} className="is-spinning" aria-hidden />Завантажуємо файл…
    </div> : state.status === 'error' ? <div className="file-preview-modal__notice" role="alert">
      <FileText size={36} aria-hidden />
      <strong>Не вдалося відкрити файл</strong>
      <span>Перевірте з’єднання та доступ до файлу. Спробуйте ще раз або завантажте його.</span>
      <button type="button" className="button button--secondary" onClick={() => setAttempt((value) => value + 1)}>Повторити</button>
    </div> : state.status === 'too-large' ? <div className="file-preview-modal__notice" role="status">
      <FileText size={36} aria-hidden /><strong>Текстовий файл завеликий для перегляду</strong>
      <span>Перегляд доступний для файлів до 1 МБ. Завантажте файл, щоб прочитати його повністю.</span>
    </div> : state.status === 'ready' && (kind === 'pdf'
      ? <iframe title={`Перегляд ${fileName}`} src={state.content} />
      : <pre className="file-preview-modal__text" tabIndex={0} aria-label={`Текст ${fileName}`}>{state.content || 'Файл порожній'}</pre>)}
    {copyStatus && <p className="file-preview-modal__copy-status" role="status">{copyStatus}</p>}
  </div>
}
