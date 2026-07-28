import { describe, expect, it } from 'vitest'
import { scoreChatRecommendation } from './chat-recommendations.js'

const now = new Date('2026-07-28T12:00:00.000Z')
const base = {
  sentCount: 0,
  receivedCount: 0,
  sharedGroup: false,
  activeTaskRelationship: false,
  sharedOrgUnit: false,
}

describe('chat recommendation score', () => {
  it('applies a 21-day recency half-life', () => {
    const recent = scoreChatRecommendation({ ...base, lastInteractionAt: now }, now)
    const halfLife = scoreChatRecommendation({
      ...base,
      lastInteractionAt: new Date(now.getTime() - 21 * 86_400_000),
    }, now)
    expect(halfLife.score).toBeCloseTo(recent.score / 2, 6)
    expect(recent.reason).toBe('RECENT')
  })

  it('caps frequency and rewards reciprocal conversations', () => {
    const capped = scoreChatRecommendation({
      ...base,
      lastInteractionAt: null,
      sentCount: 40,
      receivedCount: 40,
    }, now)
    const aboveCap = scoreChatRecommendation({
      ...base,
      lastInteractionAt: null,
      sentCount: 400,
      receivedCount: 400,
    }, now)
    const oneSided = scoreChatRecommendation({
      ...base,
      lastInteractionAt: null,
      sentCount: 40,
      receivedCount: 0,
    }, now)
    expect(aboveCap.score).toBeCloseTo(capped.score, 6)
    expect(capped.score).toBeGreaterThan(oneSided.score)
    expect(capped.reason).toBe('FREQUENT')
  })

  it('uses deterministic context weights and explicit team fallback', () => {
    const context = scoreChatRecommendation({
      ...base,
      lastInteractionAt: null,
      sharedGroup: true,
      activeTaskRelationship: true,
      sharedOrgUnit: true,
    }, now)
    expect(context.score).toBeCloseTo(0.15, 6)
    expect(context.reason).toBe('SHARED_CONTEXT')
    expect(scoreChatRecommendation({
      ...base,
      lastInteractionAt: null,
      fallbackTeam: true,
    }, now).reason).toBe('TEAM')
  })
})
