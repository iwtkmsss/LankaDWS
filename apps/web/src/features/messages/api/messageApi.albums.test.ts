import type { ChatAttachmentView } from '@lankadws/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../../shared/api/client'
import { sendMessage } from './messageApi'

vi.mock('../../../shared/api/client', () => ({
  api: vi.fn(), jsonBody: JSON.stringify, idempotencyKey: vi.fn(),
}))

const photos = (count: number): ChatAttachmentView[] => Array.from({ length: count }, (_, index) => ({
  id: `photo-${index}`, fileName: `${index}.png`, mimeType: 'image/png', bytes: 10, scanStatus: 'CLEAN',
}))
const payload = (attachments: ChatAttachmentView[]) => ({
  body: 'Підпис', mentions: [], replyToId: 'original', attachmentIds: attachments.map(({ id }) => id),
})
const requests = () => vi.mocked(api).mock.calls.map(([, options]) => ({
  body: JSON.parse(options!.body as string), headers: options!.headers,
}))

beforeEach(() => { vi.mocked(api).mockReset().mockResolvedValue({ id: 'sent' }) })

describe('chat photo album sending', () => {
  it.each([1, 10, 11, 15, 20, 25])('sends %i photos in messages of at most ten', async (count) => {
    const attachments = photos(count)
    await sendMessage('thread', payload(attachments), 'attempt', attachments)
    const calls = requests()
    expect(calls.map(({ body }) => body.attachmentIds.length)).toEqual(
      Array.from({ length: Math.ceil(count / 10) }, (_, index) => Math.min(10, count - index * 10)))
    expect(calls.flatMap(({ body }) => body.attachmentIds)).toEqual(attachments.map(({ id }) => id))
    expect(calls[0]!.body.body).toBe('Підпис')
    for (const { body } of calls.slice(1)) {
      expect(body.body).toBe('')
      expect(body.mentions).toEqual([])
      expect(body.replyToId).toBe('original')
    }
  })

  it('sends a mixed selection together as files', async () => {
    const attachments = [...photos(15), { ...photos(1)[0]!, id: 'document', mimeType: 'application/pdf' }]
    await sendMessage('thread', payload(attachments), 'mixed', attachments)
    expect(requests()).toHaveLength(1)
    expect(requests()[0]!.body.attachmentIds).toHaveLength(16)
  })

  it('reuses the same keys after a partially failed send', async () => {
    const attachments = photos(25)
    vi.mocked(api).mockResolvedValueOnce({ id: 'first' }).mockRejectedValueOnce(new Error('offline'))
    await expect(sendMessage('thread', payload(attachments), 'retry', attachments)).rejects.toThrow('offline')
    await sendMessage('thread', payload(attachments), 'retry', attachments)
    expect(requests().map(({ headers }) => headers)).toEqual([
      { 'idempotency-key': 'retry' }, { 'idempotency-key': 'retry:album:1' },
      { 'idempotency-key': 'retry' }, { 'idempotency-key': 'retry:album:1' }, { 'idempotency-key': 'retry:album:2' },
    ])
  })

  it('preserves text-only messages', async () => {
    await sendMessage('thread', payload([]), 'text', [])
    expect(requests()[0]!.body).toEqual(payload([]))
  })
})
