import { describe, expect, it, vi } from 'vitest'
import { FEED_PHOTO_MAX_BYTES } from '@lankadws/contracts'
import { FeedService } from './feed.service.js'

const principal = { userId: 'viewer', workspaceId: 'workspace' }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=', 'base64')

function setup() {
  const stageUpload = vi.fn().mockResolvedValue({ id: 'photo', scanStatus: 'QUARANTINED' })
  const files = { stageUpload, assertAttachable: vi.fn() }
  const service = new FeedService({} as never, {} as never, files as never)
  const access = vi.spyOn(service as unknown as { accessiblePost: (...args: unknown[]) => Promise<unknown> }, 'accessiblePost').mockResolvedValue({ id: 'post', companyId: 'company' })
  return { service, access, files }
}

describe('Feed comment photo uploads', () => {
  it('authorizes the canonical post and stages a detected image in its company', async () => {
    const { service, access, files } = setup()
    const file = { originalname: 'screen.png', mimetype: 'application/octet-stream', buffer: png, size: png.length }
    await expect(service.uploadCommentAttachment(principal as never, 'post', file)).resolves.toMatchObject({ id: 'photo' })
    expect(access).toHaveBeenCalledWith(principal, 'post')
    expect(files.stageUpload).toHaveBeenCalledWith(principal, file, 'company')
  })

  it('rejects oversized, empty and disguised non-image uploads before persistence', async () => {
    const { service, files } = setup()
    const file = { originalname: 'screen.png', mimetype: 'image/png', buffer: png, size: png.length }
    for (const size of [0, FEED_PHOTO_MAX_BYTES + 1]) {
      await expect(service.uploadCommentAttachment(principal as never, 'post', { ...file, size })).rejects.toMatchObject({ code: 'feed_comment_photo_size' })
    }
    await expect(service.uploadCommentAttachment(principal as never, 'post', { ...file, buffer: Buffer.from('plain text') })).rejects.toMatchObject({ code: 'feed_comment_photo_type' })
    expect(files.stageUpload).not.toHaveBeenCalled()
  })

  it('checks post access before accepting any bytes', async () => {
    const { service, access, files } = setup()
    access.mockRejectedValue(new Error('not found'))
    await expect(service.uploadCommentAttachment(principal as never, 'private', { originalname: 'screen.png', mimetype: 'image/png', buffer: png, size: png.length })).rejects.toThrow('not found')
    expect(files.stageUpload).not.toHaveBeenCalled()
  })
})
