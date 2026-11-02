import { describe, expect, it } from 'vitest'
import { fitPhoto, photoError, resizePhoto, SHOWCASE_PHOTO_MAX_BYTES } from './showcasePhotos'

it('accepts supported photos within the limit and rejects oversized or other files', () => {
  expect(photoError({ type: 'image/png', size: SHOWCASE_PHOTO_MAX_BYTES })).toBeNull()
  expect(photoError({ type: 'image/jpeg', size: SHOWCASE_PHOTO_MAX_BYTES + 1 })).toContain('10 МБ')
  expect(photoError({ type: 'image/svg+xml', size: 10 })).toContain('PNG')
  expect(photoError({ type: 'application/pdf', size: 10 })).toContain('PNG')
})

it('keeps moved and responsive photos inside the text block without changing their proportions', () => {
  for (const bounds of [{ width: 900, height: 360 }, { width: 280, height: 360 }]) {
    for (const photo of [{ x: -1, y: -500, width: .5, ratio: 2 }, { x: 2, y: 900, width: 1, ratio: .3 }]) {
      const rect = fitPhoto(photo, bounds)
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.width)
      expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.height)
      expect(rect.width / rect.height).toBeCloseTo(photo.ratio)
    }
  }
})

describe.each(['top-left', 'top-right', 'bottom-left', 'bottom-right'])('resize from %s', (corner) => {
  it('preserves the opposite corner, aspect ratio and text-block boundary', () => {
    const original = { x: 70, y: 60, width: 160, height: 80 }, bounds = { width: 400, height: 300 }
    for (const delta of [-1000, 1000]) {
      const next = resizePhoto(original, 2, bounds, corner, delta, delta)
      expect(next.x).toBeGreaterThanOrEqual(0)
      expect(next.y).toBeGreaterThanOrEqual(0)
      expect(next.x + next.width).toBeLessThanOrEqual(bounds.width)
      expect(next.y + next.height).toBeLessThanOrEqual(bounds.height)
      expect(next.width / next.height).toBeCloseTo(2)
      expect(corner.includes('left') ? next.x + next.width : next.x).toBe(corner.includes('left') ? original.x + original.width : original.x)
      expect(corner.includes('top') ? next.y + next.height : next.y).toBe(corner.includes('top') ? original.y + original.height : original.y)
    }
  })
})
