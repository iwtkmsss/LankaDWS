import type { PrismaService } from '../../prisma/prisma.service.js';

export const retentionCategories = [
  'notifications',
  'closed_sessions',
  'job_details',
] as const;
export type RetentionCategory = (typeof retentionCategories)[number];

export interface RetentionPlan {
  category: RetentionCategory;
  cutoff: string;
  eligibleCount: number;
  heldCount: number;
  ids: string[];
}

export function isRetentionCategory(value: string): value is RetentionCategory {
  return retentionCategories.includes(value as RetentionCategory);
}

export async function buildRetentionPlan(
  prisma: PrismaService,
  workspaceId: string,
  category: RetentionCategory,
  cutoff: Date,
): Promise<RetentionPlan> {
  const userIds = (
    await prisma.user.findMany({ where: { workspaceId }, select: { id: true } })
  ).map((user) => user.id);
  let entityType: string;
  let candidates: string[];

  if (category === 'notifications') {
    entityType = 'NOTIFICATION';
    candidates = (
      await prisma.notification.findMany({
        where: {
          recipientId: { in: userIds },
          createdAt: { lt: cutoff },
          requiresAction: false,
        },
        select: { id: true },
      })
    ).map((row) => row.id);
  } else if (category === 'closed_sessions') {
    entityType = 'SESSION';
    candidates = (
      await prisma.userSession.findMany({
        where: {
          userId: { in: userIds },
          createdAt: { lt: cutoff },
          OR: [{ revokedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
        },
        select: { id: true },
      })
    ).map((row) => row.id);
  } else {
    entityType = 'JOB';
    candidates = (
      await prisma.backgroundJob.findMany({
        where: {
          createdAt: { lt: cutoff },
          state: { in: ['SUCCEEDED', 'FAILED', 'CANCELLED'] },
        },
        select: { id: true },
      })
    ).map((row) => row.id);
  }

  const held =
    candidates.length === 0
      ? []
      : await prisma.legalHold.findMany({
          where: {
            entityType,
            entityId: { in: candidates },
            status: 'ACTIVE',
            releasedAt: null,
          },
          select: { entityId: true },
        });
  const heldIds = new Set(held.map((row) => row.entityId));
  const ids = candidates.filter((candidate) => !heldIds.has(candidate));
  return {
    category,
    cutoff: cutoff.toISOString(),
    eligibleCount: ids.length,
    heldCount: heldIds.size,
    ids,
  };
}

export async function executeRetentionPlan(
  prisma: PrismaService,
  plan: RetentionPlan,
): Promise<number> {
  let deleted = 0;
  for (let offset = 0; offset < plan.ids.length; offset += 500) {
    const ids = plan.ids.slice(offset, offset + 500);
    const result =
      plan.category === 'notifications'
        ? await prisma.notification.deleteMany({ where: { id: { in: ids } } })
        : plan.category === 'closed_sessions'
          ? await prisma.userSession.deleteMany({ where: { id: { in: ids } } })
          : await prisma.backgroundJob.deleteMany({
              where: { id: { in: ids } },
            });
    deleted += result.count;
  }
  return deleted;
}
