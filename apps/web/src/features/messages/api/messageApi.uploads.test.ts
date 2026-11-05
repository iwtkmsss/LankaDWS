import type { ChatAttachmentView } from '@lankadws/contracts'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api, uploadApi } from '../../../shared/api/client'
import { stageMessageFiles } from '../lib/localAttachments'
import { usePendingUploads } from '../lib/pendingUploads'
import { sendMessage } from './messageApi'

vi.mock('../../../shared/api/client', async (original) => ({
  ...await original<typeof import('../../../shared/api/client')>(), api: vi.fn(), uploadApi: vi.fn(),
}))
const uploaded = (id: string): ChatAttachmentView => ({ id, fileName: 'report.txt', bytes: 4, mimeType: 'text/plain', scanStatus: 'CLEAN' })
const payload = (items: ChatAttachmentView[]) => ({ body: 'Підпис', mentions: [], attachmentIds: items.map((item) => item.id) })
beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue({ id: 'message' })
  vi.mocked(uploadApi).mockReset()
})

describe('local message attachments', () => {
  it('does not upload on selection; uploads on send and posts only server attachment IDs', async () => {
    const items = stageMessageFiles([new File(['data'], 'report.txt', { type: 'text/plain' })])
    expect(items).toHaveLength(1)
    expect(uploadApi).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
    let finish!: (attachment: ChatAttachmentView) => void
    vi.mocked(uploadApi).mockImplementation(() => new Promise((resolve) => { finish = resolve as typeof finish }))
    const { result } = renderHook(usePendingUploads)
    let pending!: Promise<{ id: string }>
    act(() => { pending = sendMessage('thread', payload(items), 'key', items) })
    expect(api).not.toHaveBeenCalled()
    expect(result.current[0]).toMatchObject({ threadId: 'thread', phase: 'uploading', loaded: 0 })
    act(() => vi.mocked(uploadApi).mock.calls[0]![3](0.5))
    expect(result.current[0]!.loaded).toBe(2)
    await act(async () => { finish(uploaded('server-file')); await pending })
    expect(JSON.parse(vi.mocked(api).mock.calls[0]![1]!.body as string).attachmentIds).toEqual(['server-file'])
    expect(result.current).toHaveLength(0)
  })

  it('rejects forbidden, oversized and empty files at selection, preserving valid files', () => {
    const error = vi.fn()
    window.addEventListener('lankadws:file-error', error)
    const big = new File(['x'], 'big.zip')
    Object.defineProperty(big, 'size', { value: 100 * 1024 * 1024 + 1 })
    const result = stageMessageFiles([new File(['x'], 'bad.exe'), big, new File([], 'empty.txt'), new File(['x'], 'ok.docx')])
    expect(result.map((item) => item.fileName)).toEqual(['ok.docx'])
    expect(error).toHaveBeenCalledTimes(3)
    expect(uploadApi).not.toHaveBeenCalled()
    window.removeEventListener('lankadws:file-error', error)
  })

  it('keeps uploaded files for retry after sending fails', async () => {
    const items = stageMessageFiles([new File(['data'], 'report.txt')])
    vi.mocked(uploadApi).mockResolvedValue(uploaded('server-file'))
    vi.mocked(api).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ id: 'message' })
    await expect(sendMessage('thread', payload(items), 'stable-key', items)).rejects.toThrow('offline')
    await sendMessage('thread', payload(items), 'stable-key', items)
    expect(uploadApi).toHaveBeenCalledTimes(1)
    expect(vi.mocked(api).mock.calls.map(([, init]) => init!.headers)).toEqual([
      { 'idempotency-key': 'stable-key' }, { 'idempotency-key': 'stable-key' },
    ])
  })

  it('cancels uploading and never posts the message; allows retry', async () => {
    const items = stageMessageFiles([new File(['data'], 'report.txt')])
    vi.mocked(uploadApi).mockImplementation((_path, _form, signal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const { result } = renderHook(usePendingUploads)
    let pending!: Promise<{ id: string }>
    act(() => { pending = sendMessage('thread', payload(items), 'cancel-key', items) })
    await act(async () => {
      result.current[0]!.cancel()
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    })
    expect(api).not.toHaveBeenCalled()
    expect(result.current).toHaveLength(0)
    vi.mocked(uploadApi).mockResolvedValue(uploaded('retry-file'))
    await act(async () => { await sendMessage('thread', payload(items), 'cancel-key', items) })
    expect(api).toHaveBeenCalledTimes(1)
  })

  it('does not publish a partial selection if any upload fails', async () => {
    const items = stageMessageFiles([new File(['a'], 'a.txt'), new File(['b'], 'b.txt')])
    vi.mocked(uploadApi).mockResolvedValueOnce(uploaded('a')).mockRejectedValueOnce(new Error('failed'))
    await expect(sendMessage('thread', payload(items), 'partial-key', items)).rejects.toThrow('failed')
    expect(api).not.toHaveBeenCalled()
    vi.mocked(uploadApi).mockResolvedValueOnce(uploaded('b'))
    await sendMessage('thread', payload(items), 'partial-key', items)
    expect(uploadApi).toHaveBeenCalledTimes(3)
    expect(JSON.parse(vi.mocked(api).mock.calls[0]![1]!.body as string).attachmentIds).toEqual(['a', 'b'])
  })
})
