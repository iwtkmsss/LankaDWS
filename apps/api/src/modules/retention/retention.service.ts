import { Injectable } from '@nestjs/common';
import { id } from '../../common/crypto.js';
import { badRequest, conflict, notFound } from '../../common/errors.js';
import type { AuthPrincipal } from '../../common/request-context.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthService } from '../auth/auth.service.js';
import { JobsService } from '../jobs/jobs.service.js';
import {
  buildRetentionPlan,
  isRetentionCategory,
  retentionCategories,
} from './retention.plan.js';

@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly jobs: JobsService,
  ) {}

  async overview(principal: AuthPrincipal) {
    const [rows, holds] = await Promise.all([
      this.prisma.retentionPolicy.findMany({
        orderBy: [{ category: 'asc' }, { version: 'desc' }],
      }),
      this.prisma.legalHold.findMany({
        where: { status: 'ACTIVE', releasedAt: null },
        orderBy: { placedAt: 'desc' },
        take: 100,
      }),
    ]);
    const latest = rows.filter(
      (row, index) =>
        rows.findIndex((candidate) => candidate.category === row.category) ===
        index,
    );
    return {
      categories: retentionCategories,
      policies: latest,
      activeHolds: holds,
      workspaceId: principal.workspaceId,
    };
  }

  async updatePolicy(
    principal: AuthPrincipal,
    category: string,
    input: {
      expectedVersion: number;
      durationDays: number;
      effectiveAt: string;
      reason: string;
    },
    reauthChallengeId?: string,
  ) {
    await this.auth.assertRecentReauth(principal, reauthChallengeId);
    if (
      !isRetentionCategory(category) ||
      !Number.isInteger(input.durationDays) ||
      input.durationDays < 1 ||
      input.durationDays > 3_650 ||
      !input.reason.trim()
    )
      throw badRequest('retention_policy');
    const current = await this.prisma.retentionPolicy.findFirst({
      where: { category },
      orderBy: { version: 'desc' },
    });
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== input.expectedVersion) throw conflict();
    const effectiveAt = new Date(input.effectiveAt);
    if (Number.isNaN(effectiveAt.getTime())) throw badRequest('effective_at');
    const policy = await this.prisma.$transaction(async (tx) => {
      const created = await tx.retentionPolicy.create({
        data: {
          id: id('rtp'),
          category,
          durationDays: input.durationDays,
          action: 'PURGE',
          version: currentVersion + 1,
          effectiveAt,
          changedBy: principal.userId,
        },
      });
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'retention.policy_changed',
          entityType: 'RETENTION_POLICY',
          entityId: created.id,
          result: 'SUCCESS',
          risk: 'CRITICAL',
          reasonCode: input.reason.trim(),
          safeDiffJson: JSON.stringify({
            category,
            beforeDays: current?.durationDays ?? null,
            afterDays: input.durationDays,
            effectiveAt: effectiveAt.toISOString(),
          }),
          correlationId: id('corr'),
        },
      });
      return created;
    });
    return policy;
  }

  async placeHold(
    principal: AuthPrincipal,
    input: { entityType: string; entityId: string; reason: string },
    reauthChallengeId?: string,
  ) {
    await this.auth.assertRecentReauth(principal, reauthChallengeId);
    const entityType = input.entityType.trim().toUpperCase();
    const entityId = input.entityId.trim();
    const reason = input.reason.trim();
    if (!entityType || !entityId || !reason)
      throw badRequest('legal_hold_fields');
    const existing = await this.prisma.legalHold.findFirst({
      where: { entityType, entityId, status: 'ACTIVE', releasedAt: null },
    });
    if (existing) return existing;
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.legalHold.create({
        data: {
          id: id('hold'),
          entityType,
          entityId,
          reason,
          placedBy: principal.userId,
          status: 'ACTIVE',
        },
      });
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'legal_hold.placed',
          entityType,
          entityId,
          result: 'SUCCESS',
          risk: 'CRITICAL',
          reasonCode: reason,
          safeDiffJson: JSON.stringify({ holdId: hold.id }),
          correlationId: id('corr'),
        },
      });
      return hold;
    });
  }

  async releaseHold(
    principal: AuthPrincipal,
    holdId: string,
    reason: string,
    reauthChallengeId?: string,
  ) {
    await this.auth.assertRecentReauth(principal, reauthChallengeId);
    if (!reason.trim()) throw badRequest('reason_required');
    const hold = await this.prisma.legalHold.findFirst({
      where: { id: holdId, status: 'ACTIVE', releasedAt: null },
    });
    if (!hold) throw notFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.legalHold.update({
        where: { id: hold.id },
        data: {
          status: 'RELEASED',
          releasedBy: principal.userId,
          releasedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId: principal.workspaceId,
          actorType: 'USER',
          actorId: principal.userId,
          action: 'legal_hold.released',
          entityType: hold.entityType,
          entityId: hold.entityId,
          result: 'SUCCESS',
          risk: 'CRITICAL',
          reasonCode: reason.trim(),
          safeDiffJson: JSON.stringify({ holdId }),
          correlationId: id('corr'),
        },
      });
    });
    return { released: true };
  }

  async dryRun(
    principal: AuthPrincipal,
    category: string,
    cutoffInput?: string,
  ) {
    if (!isRetentionCategory(category)) throw badRequest('retention_category');
    const cutoff = cutoffInput
      ? new Date(cutoffInput)
      : await this.policyCutoff(category);
    if (Number.isNaN(cutoff.getTime())) throw badRequest('retention_cutoff');
    const plan = await buildRetentionPlan(
      this.prisma,
      principal.workspaceId,
      category,
      cutoff,
    );
    return { ...plan, ids: undefined, dryRun: true };
  }

  async purge(
    principal: AuthPrincipal,
    input: {
      category: string;
      cutoff?: string;
      expectedCount: number;
      reason: string;
    },
    idempotencyKey: string,
    reauthChallengeId?: string,
  ) {
    await this.auth.assertRecentReauth(principal, reauthChallengeId);
    if (
      !isRetentionCategory(input.category) ||
      !input.reason.trim() ||
      !idempotencyKey.trim()
    )
      throw badRequest('retention_purge');
    const durableKey = `retention:${principal.workspaceId}:${idempotencyKey}`;
    const existing = await this.prisma.backgroundJob.findUnique({
      where: { idempotencyKey: durableKey },
    });
    if (existing) {
      let prior: Record<string, unknown> = {};
      try {
        prior = JSON.parse(existing.safePayload) as Record<string, unknown>;
      } catch {
        /* Safe fallback below. */
      }
      return {
        purgeId: existing.entityId,
        jobId: existing.id,
        state: existing.state,
        expectedCount: Number(prior.expectedCount ?? 0),
        heldCount: Number(prior.heldCount ?? 0),
      };
    }
    const cutoff = input.cutoff
      ? new Date(input.cutoff)
      : await this.policyCutoff(input.category);
    if (Number.isNaN(cutoff.getTime())) throw badRequest('retention_cutoff');
    const plan = await buildRetentionPlan(
      this.prisma,
      principal.workspaceId,
      input.category,
      cutoff,
    );
    if (plan.eligibleCount !== input.expectedCount)
      throw conflict(`Retention preview changed: ${plan.eligibleCount}`);
    const purgeId = id('purge');
    const jobId = await this.jobs.enqueue(
      'retention.purge',
      'RETENTION',
      purgeId,
      {
        workspaceId: principal.workspaceId,
        actorId: principal.userId,
        category: input.category,
        cutoff: cutoff.toISOString(),
        reason: input.reason.trim(),
        purgeId,
        expectedCount: plan.eligibleCount,
        heldCount: plan.heldCount,
      },
      durableKey,
    );
    await this.prisma.auditEvent.create({
      data: {
        id: id('aud'),
        workspaceId: principal.workspaceId,
        actorType: 'USER',
        actorId: principal.userId,
        action: 'retention.purge_requested',
        entityType: 'RETENTION',
        entityId: purgeId,
        result: 'QUEUED',
        risk: 'CRITICAL',
        reasonCode: input.reason.trim(),
        safeDiffJson: JSON.stringify({
          category: input.category,
          cutoff: cutoff.toISOString(),
          expectedCount: input.expectedCount,
          jobId,
        }),
        correlationId: id('corr'),
      },
    });
    return {
      purgeId,
      jobId,
      state: 'QUEUED',
      expectedCount: plan.eligibleCount,
      heldCount: plan.heldCount,
    };
  }

  private async policyCutoff(category: string): Promise<Date> {
    const policy = await this.prisma.retentionPolicy.findFirst({
      where: { category, effectiveAt: { lte: new Date() } },
      orderBy: { version: 'desc' },
    });
    if (!policy) throw badRequest('retention_policy_missing');
    return new Date(Date.now() - policy.durationDays * 86_400_000);
  }
}
