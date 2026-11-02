import { describe, expect, it } from 'vitest'
import { fitPhoto, layoutDepth, rectToPlacement, resizePhoto, toPhotoLayout } from './feedInlinePhotos'

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

it('stores positions relative to the block width so the layout scales', () => {
  const placement = { x: .1, y: .2, width: .4, ratio: 2 }
  for (const width of [300, 900]) {
    const bounds = { width, height: width * 2 }
    expect(rectToPlacement(fitPhoto(placement, bounds), bounds)).toEqual({ x: .1, y: .2, width: .4 })
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

it('serializes a contract-valid layout and measures its depth', () => {
  const layout = toPhotoLayout([{ id: 'photo', src: '', name: 'photo', ratio: 2, x: .9, y: -1, width: .5 }])
  expect(layout).toEqual([{ fileId: 'photo', x: .5, y: 0, width: .5, height: .25 }])
  expect(layoutDepth([...layout, { y: .5, height: .3 }])).toBeCloseTo(.8)
})
