import type { RecommendedChatReason } from '@bert-crm/contracts'

export interface ChatRecommendationSignals {
  lastInteractionAt: Date | null
  sentCount: number
  receivedCount: number
  sharedGroup: boolean
  activeTaskRelationship: boolean
  sharedOrgUnit: boolean
  fallbackTeam?: boolean
}

export interface ChatRecommendationScore {
  score: number
  reason: RecommendedChatReason
}

const halfLifeDays = 21
const frequencyCap = 40

export function scoreChatRecommendation(
  signals: ChatRecommendationSignals,
  now = new Date(),
): ChatRecommendationScore {
  const ageDays = signals.lastInteractionAt
    ? Math.max(0, (now.getTime() - signals.lastInteractionAt.getTime()) / 86_400_000)
    : Number.POSITIVE_INFINITY
  const recency = Number.isFinite(ageDays)
    ? Math.exp(-Math.log(2) * ageDays / halfLifeDays)
    : 0
  const total = Math.min(frequencyCap, signals.sentCount + signals.receivedCount)
  const largerDirection = Math.max(signals.sentCount, signals.receivedCount)
  const reciprocity = largerDirection
    ? Math.min(signals.sentCount, signals.receivedCount) / largerDirection
    : 0
  const frequency = total
    ? Math.log1p(total) / Math.log1p(frequencyCap) * (0.5 + 0.5 * reciprocity)
    : 0
  const context = (
    (signals.sharedGroup ? 0.45 : 0)
    + (signals.activeTaskRelationship ? 0.35 : 0)
    + (signals.sharedOrgUnit ? 0.2 : 0)
  )
  const contributions = {
    RECENT: recency * 0.5,
    FREQUENT: frequency * 0.35,
    SHARED_CONTEXT: context * 0.15,
  } as const
  const reason = signals.fallbackTeam
    ? 'TEAM'
    : (Object.entries(contributions)
        .sort((left, right) => right[1] - left[1])[0]?.[0] as RecommendedChatReason | undefined)
      ?? 'TEAM'
  return {
    score: contributions.RECENT + contributions.FREQUENT + contributions.SHARED_CONTEXT,
    reason,
  }
}
