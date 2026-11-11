import { describe, expect, it } from 'vitest'
import { FEED_FALLBACK_POLL_MS, feedFallbackInterval } from './FeedPage'

describe('feed fallback poll', () => {
  it('polls slowly while one page is loaded and stops once the reader has paged deeper', () => {
    expect(FEED_FALLBACK_POLL_MS).toBe(60_000)
    expect(feedFallbackInterval(0)).toBe(60_000)
    expect(feedFallbackInterval(1)).toBe(60_000)
    expect(feedFallbackInterval(2)).toBe(false)
  })
})
