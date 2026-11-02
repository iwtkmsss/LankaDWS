import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiProblem, setCsrfToken, uploadApi } from './client'

class UploadRequest {
  static last: UploadRequest
  status = 200
  response: unknown = { id: 'file' }
  responseType = ''
  withCredentials = false
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null, onload: null as (() => void) | null }
  onload: (() => void) | null = null
  onabort: (() => void) | null = null
  onerror: (() => void) | null = null
  open = vi.fn()
  setRequestHeader = vi.fn()
  send = vi.fn()
  abort = vi.fn(() => this.onabort?.())
  getResponseHeader = vi.fn(() => null)
  constructor() { UploadRequest.last = this }
}

afterEach(() => { vi.unstubAllGlobals(); setCsrfToken('') })

describe('multipart upload transport', () => {
  it('preserves authentication and sends real progress without setting a multipart boundary', async () => {
    vi.stubGlobal('XMLHttpRequest', UploadRequest)
    setCsrfToken('csrf')
    const form = new FormData()
    form.append('file', new File(['data'], 'report.txt'))
    const progress = vi.fn()
    const result = uploadApi('/messages/threads/t/attachments', form, new AbortController().signal, progress)
    const request = UploadRequest.last
    expect(request.open).toHaveBeenCalledWith('POST', '/api/v1/messages/threads/t/attachments')
    expect(request.withCredentials).toBe(true)
    expect(request.setRequestHeader).toHaveBeenCalledExactlyOnceWith('x-csrf-token', 'csrf')
    expect(request.send).toHaveBeenCalledWith(form)
    request.upload.onprogress!({ lengthComputable: true, loaded: 20, total: 100 })
    request.upload.onload!()
    request.onload!()
    await expect(result).resolves.toEqual({ id: 'file' })
    expect(progress.mock.calls).toEqual([[0.2], [1]])
  })

  it('aborts the request when sending is cancelled', async () => {
    vi.stubGlobal('XMLHttpRequest', UploadRequest)
    const controller = new AbortController()
    const result = uploadApi('/upload', new FormData(), controller.signal, vi.fn())
    controller.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(UploadRequest.last.abort).toHaveBeenCalledTimes(1)
  })

  it('preserves server validation errors and session expiry events', async () => {
    vi.stubGlobal('XMLHttpRequest', UploadRequest)
    const session = vi.fn()
    window.addEventListener('lankadws:session-ended', session)
    const result = uploadApi('/upload', new FormData(), new AbortController().signal, vi.fn())
    UploadRequest.last.status = 401
    UploadRequest.last.response = { title: 'Session ended', status: 401, code: 'authentication_required' }
    UploadRequest.last.onload!()
    await expect(result).rejects.toBeInstanceOf(ApiProblem)
    expect(session).toHaveBeenCalledTimes(1)
    window.removeEventListener('lankadws:session-ended', session)
  })
})
