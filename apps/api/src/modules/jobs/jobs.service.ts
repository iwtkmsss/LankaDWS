import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { id } from '../../common/crypto.js';
import { getConfig } from '../../config/config.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { writeFeedProjection } from '../feed/feed-projection.service.js';
import { promoteFile, writeCleanFile } from '../files/storage.js';
import {
  buildRetentionPlan,
  executeRetentionPlan,
  isRetentionCategory,
} from '../retention/retention.plan.js';

function payloadString(
  payload: Record<string, unknown>,
  key: string,
  fallback = '',
): string {
  const value = payload[key];
  return typeof value === 'string' ? value : fallback;
}

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private active = false;
  private readonly workerId = id('worker');

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (process.env.DISABLE_JOB_WORKER === 'true') return;
    this.timer = setInterval(() => void this.tick(), getConfig().JOB_POLL_MS);
    this.timer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    const deadline = Date.now() + 5000;
    while (this.active && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
  }

  async enqueue(
    type: string,
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
    runAt = new Date(),
  ): Promise<string> {
    const existing = await this.prisma.backgroundJob.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing.id;
    const job = await this.prisma.backgroundJob.create({
      data: {
        id: id('job'),
        type,
        entityType,
        entityId,
        safePayload: JSON.stringify(payload),
        idempotencyKey,
        runAt,
      },
    });
    return job.id;
  }

  async dispatchOutbox(): Promise<void> {
    const events = await this.prisma.outboxEvent.findMany({
      where: { state: 'PENDING', nextRunAt: { lte: new Date() } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    for (const event of events) {
      const claimed = await this.prisma.outboxEvent.updateMany({
        where: { id: event.id, state: 'PENDING' },
        data: { state: 'PROCESSING', attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      try {
        const payload = JSON.parse(event.safePayload) as Record<
          string,
          unknown
        >;
        await this.enqueue(
          event.eventType,
          event.aggregateType,
          event.aggregateId,
          payload,
          `outbox:${event.id}`,
        );
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { state: 'PROCESSED', processedAt: new Date() },
        });
      } catch {
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            state: event.attempts >= 4 ? 'FAILED' : 'PENDING',
            nextRunAt: new Date(Date.now() + 2 ** event.attempts * 1000),
          },
        });
      }
    }
  }

  async runOnce(): Promise<void> {
    await this.dispatchOutbox();
    const now = new Date();
    const expired = await this.prisma.backgroundJob.findFirst({
      where: { state: 'RUNNING', leaseUntil: { lt: now } },
      orderBy: [{ leaseUntil: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    await this.prisma.backgroundJob.updateMany({
      where: { state: 'RUNNING', leaseUntil: { lt: now } },
      data: {
        state: 'QUEUED',
        leaseOwner: null,
        leaseUntil: null,
        runAt: now,
        lastErrorCode: 'lease_expired',
      },
    });
    const candidate = expired
      ? await this.prisma.backgroundJob.findFirst({
          where: { id: expired.id, state: 'QUEUED', runAt: { lte: now } },
        })
      : await this.prisma.backgroundJob.findFirst({
          where: { state: 'QUEUED', runAt: { lte: now } },
          orderBy: [{ runAt: 'asc' }, { id: 'asc' }],
        });
    if (!candidate) return;
    const leaseUntil = new Date(
      Date.now() + getConfig().JOB_LEASE_SECONDS * 1000,
    );
    const claimed = await this.prisma.backgroundJob.updateMany({
      where: { id: candidate.id, state: 'QUEUED' },
      data: {
        state: 'RUNNING',
        leaseOwner: this.workerId,
        leaseUntil,
        attempts: { increment: 1 },
      },
    });
    if (!claimed.count) return;
    try {
      await this.handle(
        candidate.type,
        candidate.entityId,
        JSON.parse(candidate.safePayload) as Record<string, unknown>,
      );
      await this.prisma.backgroundJob.update({
        where: { id: candidate.id },
        data: {
          state: 'SUCCEEDED',
          progress: 100,
          leaseOwner: null,
          leaseUntil: null,
          lastErrorCode: null,
        },
      });
    } catch (error) {
      const nextState =
        candidate.attempts + 1 >= candidate.maxAttempts ? 'FAILED' : 'QUEUED';
      await this.prisma.backgroundJob.update({
        where: { id: candidate.id },
        data: {
          state: nextState,
          leaseOwner: null,
          leaseUntil: null,
          lastErrorCode:
            error instanceof Error ? error.name.slice(0, 64) : 'job_failed',
          runAt: new Date(
            Date.now() +
              Math.min(
                300_000,
                2 ** (candidate.attempts + 1) * 1000 +
                  Math.floor(Math.random() * 500),
              ),
          ),
        },
      });
    }
  }

  private async tick(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      await this.runOnce();
    } finally {
      this.active = false;
    }
  }

  private async handle(
    type: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (type === 'announcement.materialize')
      return this.materializeAnnouncement(entityId);
    if (type === 'file.scan') return this.markDevelopmentScan(entityId);
    if (type === 'task.recurrence')
      return this.createRecurringTask(entityId, payload);
    if (type === 'task.reminder') return this.deliverTaskReminder(entityId);
    if (type === 'retention.purge') return this.runRetention(entityId, payload);
    if (type === 'export.generate')
      return this.generateAuditExport(entityId, payload);
    if (type === 'search.index' || type === 'document.preview') return;
    throw new Error('UnknownJobType');
  }

  private async materializeAnnouncement(announcementId: string): Promise<void> {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
      include: { companies: true, roles: true, users: true },
    });
    if (!announcement) throw new Error('AnnouncementMissing');
    let effectiveVersion = announcement.version;
    if (
      announcement.status === 'SCHEDULED' &&
      announcement.publishAt &&
      announcement.publishAt <= new Date()
    ) {
      const published = await this.prisma.announcement.update({
        where: { id: announcement.id },
        data: { status: 'PUBLISHED', version: { increment: 1 } },
      });
      effectiveVersion = published.version;
    }
    const users = await this.prisma.user.findMany({
      where: {
        status: 'ACTIVE',
        OR: [
          { id: { in: announcement.users.map((entry) => entry.userId) } },
          {
            primaryCompanyId: {
              in: announcement.companies.map((entry) => entry.companyId),
            },
          },
          {
            roles: {
              some: {
                roleId: { in: announcement.roles.map((entry) => entry.roleId) },
                status: 'ACTIVE',
              },
            },
          },
        ],
      },
      select: { id: true },
    });
    await this.prisma.$transaction(async (tx) => {
      for (const user of users) {
        await tx.announcementReceipt.upsert({
          where: { announcementId_userId: { announcementId, userId: user.id } },
          create: {
            id: id('anr'),
            announcementId,
            userId: user.id,
            effectiveContentVersion: effectiveVersion,
          },
          update: { effectiveContentVersion: effectiveVersion },
        });
      }
      for (const company of announcement.companies) {
        await writeFeedProjection(tx, {
          workspaceId: announcement.workspaceId,
          companyId: company.companyId,
          sourceType: 'ANNOUNCEMENT',
          sourceId: announcement.id,
          sourceVersion: effectiveVersion,
          action: 'PUBLISHED',
          actorId: announcement.authorId,
          recipientIds: users.map((user) => user.id),
          visibility: 'PARTICIPANTS',
          occurredAt: announcement.publishAt ?? new Date(),
        });
      }
    });
  }

  private async markDevelopmentScan(fileId: string): Promise<void> {
    if (getConfig().MALWARE_SCANNER !== 'development-clean')
      throw new Error('ScannerUnavailable');
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
    });
    if (!file) throw new Error('FileMissing');
    await promoteFile(file.storageKey);
    await this.prisma.fileObject.update({
      where: { id: fileId },
      data: { scanStatus: 'CLEAN' },
    });
  }

  private async createRecurringTask(
    sourceTaskId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const source = await this.prisma.task.findUnique({
      where: { id: sourceTaskId },
    });
    if (
      !source ||
      source.archivedAt ||
      ['CANCELLED', 'ARCHIVED'].includes(source.status)
    )
      return;
    const seriesKey = payloadString(payload, 'seriesKey');
    const frequency = payloadString(payload, 'frequency');
    const interval = Number(payload.interval);
    const occurrenceAt = new Date(payloadString(payload, 'occurrenceAt'));
    const untilText = payloadString(payload, 'until');
    const until = untilText ? new Date(untilText) : undefined;
    if (
      !seriesKey ||
      !['DAILY', 'WEEKLY', 'MONTHLY'].includes(frequency) ||
      !Number.isInteger(interval) ||
      interval < 1 ||
      Number.isNaN(occurrenceAt.getTime())
    )
      throw new Error('RecurrencePayloadInvalid');
    const occurrenceKey = `${seriesKey}:${occurrenceAt.toISOString()}`;
    const existing = await this.prisma.task.findUnique({
      where: { recurrenceKey: occurrenceKey },
    });
    if (!existing) {
      const taskId = id('tsk');
      await this.prisma.$transaction(async (tx) => {
        await tx.task.create({
          data: {
            id: taskId,
            workspaceId: source.workspaceId,
            companyId: source.companyId,
            number: `TSK-R${Date.now().toString().slice(-7)}`,
            title: source.title,
            description: source.description,
            creatorId: source.creatorId,
            assigneeId: source.assigneeId,
            status: 'NEW',
            priority: source.priority,
            deadline: occurrenceAt,
            recurrenceKey: occurrenceKey,
          },
        });
        await tx.auditEvent.create({
          data: {
            id: id('aud'),
            workspaceId: source.workspaceId,
            companyId: source.companyId,
            actorType: 'SYSTEM',
            action: 'task.recurrence_created',
            entityType: 'TASK',
            entityId: taskId,
            result: 'SUCCESS',
            risk: 'NORMAL',
            safeDiffJson: JSON.stringify({
              sourceTaskId,
              occurrenceAt: occurrenceAt.toISOString(),
            }),
            correlationId: id('corr'),
          },
        });
      });
    }
    const next = new Date(occurrenceAt);
    if (frequency === 'DAILY') next.setUTCDate(next.getUTCDate() + interval);
    else if (frequency === 'WEEKLY')
      next.setUTCDate(next.getUTCDate() + 7 * interval);
    else next.setUTCMonth(next.getUTCMonth() + interval);
    if (!until || next <= until) {
      const nextKey = `${seriesKey}:${next.toISOString()}`;
      await this.enqueue(
        'task.recurrence',
        'TASK',
        sourceTaskId,
        {
          seriesKey,
          frequency,
          interval,
          occurrenceAt: next.toISOString(),
          until: until?.toISOString() ?? '',
        },
        `recurrence:${nextKey}`,
        next,
      );
    }
  }

  private async deliverTaskReminder(reminderId: string): Promise<void> {
    const reminder = await this.prisma.taskReminder.findUnique({
      where: { id: reminderId },
      include: {
        task: true,
        user: {
          select: {
            id: true,
            status: true,
            companyAccess: {
              select: {
                companyId: true,
                status: true,
              },
            },
            groupMemberships: {
              select: {
                groupId: true,
                leftAt: true,
              },
            },
            roles: {
              where: {
                status: 'ACTIVE',
                validFrom: { lte: new Date() },
                OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
              },
              select: {
                role: {
                  select: {
                    status: true,
                    permissions: {
                      where: { permissionCode: 'tasks.manage' },
                      select: { id: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!reminder || reminder.status !== 'ACTIVE') return;
    const task = reminder.task;
    const hasCompanyAccess = reminder.user.status === 'ACTIVE'
      && reminder.user.companyAccess.some((access) => (
        access.companyId === task.companyId && access.status === 'ACTIVE'
      ));
    const hasGroupAccess = !task.groupId
      || reminder.user.groupMemberships.some((membership) => (
        membership.groupId === task.groupId && !membership.leftAt
      ));
    const isDirectActor = task.creatorId === reminder.userId
      || task.assigneeId === reminder.userId
      || Boolean(await this.prisma.taskParticipant.findFirst({
        where: {
          taskId: task.id,
          userId: reminder.userId,
          removedAt: null,
        },
        select: { id: true },
      }));
    const canManage = reminder.user.roles.some((assignment) => (
      assignment.role.status === 'ACTIVE'
      && assignment.role.permissions.length > 0
    ));
    if (
      task.archivedAt
      || !hasCompanyAccess
      || !hasGroupAccess
      || (!isDirectActor && !canManage)
    ) {
      await this.prisma.taskReminder.updateMany({
        where: { id: reminder.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const sent = await tx.taskReminder.updateMany({
        where: { id: reminder.id, status: 'ACTIVE' },
        data: { status: 'SENT' },
      });
      if (!sent.count) return;
      await tx.notification.upsert({
        where: { dedupeKey: `task-reminder:${reminder.id}:${reminder.userId}` },
        create: {
          id: id('ntf'),
          recipientId: reminder.userId,
          category: 'TASKS',
          safeTitle: 'Нагадування про завдання',
          safeSnippet: `${task.number} · ${task.title}`.slice(0, 180),
          entityType: 'TASK',
          entityId: task.id,
          requiresAction: true,
          deliveredAt: new Date(),
          dedupeKey: `task-reminder:${reminder.id}:${reminder.userId}`,
        },
        update: {},
      });
    });
  }

  private async runRetention(
    purgeId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const workspaceId = payloadString(payload, 'workspaceId');
    const actorId = payloadString(payload, 'actorId');
    const category = payloadString(payload, 'category');
    const cutoff = new Date(payloadString(payload, 'cutoff'));
    if (
      !workspaceId ||
      !isRetentionCategory(category) ||
      Number.isNaN(cutoff.getTime())
    )
      throw new Error('RetentionPayloadInvalid');
    const plan = await buildRetentionPlan(
      this.prisma,
      workspaceId,
      category,
      cutoff,
    );
    const deleted = await executeRetentionPlan(this.prisma, plan);
    await this.prisma.auditEvent.create({
      data: {
        id: id('aud'),
        workspaceId,
        actorType: actorId ? 'USER' : 'SYSTEM',
        actorId: actorId || null,
        action: 'retention.purge_completed',
        entityType: 'RETENTION',
        entityId: purgeId,
        result: 'SUCCESS',
        risk: 'CRITICAL',
        reasonCode: payloadString(payload, 'reason') || null,
        safeDiffJson: JSON.stringify({
          category,
          cutoff: cutoff.toISOString(),
          deleted,
          heldCount: plan.heldCount,
        }),
        correlationId: id('corr'),
      },
    });
  }

  private async generateAuditExport(
    exportId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const workspaceId = payloadString(payload, 'workspaceId');
    const actorId = payloadString(payload, 'actorId');
    const companyId = payloadString(payload, 'companyId');
    if (!workspaceId || !actorId || !companyId)
      throw new Error('ExportPayloadInvalid');
    const events = await this.prisma.auditEvent.findMany({
      where: { workspaceId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50_000,
    });
    const cell = (value: unknown): string => {
      const raw =
        value == null
          ? ''
          : typeof value === 'string'
            ? value
            : typeof value === 'number' || typeof value === 'boolean'
              ? String(value)
              : JSON.stringify(value);
      const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const header = [
      'timestamp',
      'action',
      'entityType',
      'entityId',
      'actorType',
      'actorId',
      'companyId',
      'result',
      'risk',
      'reasonCode',
      'correlationId',
      'safeDiff',
    ];
    const lines = [
      header.map(cell).join(','),
      ...events.map((event) =>
        [
          event.createdAt.toISOString(),
          event.action,
          event.entityType,
          event.entityId,
          event.actorType,
          event.actorId,
          event.companyId,
          event.result,
          event.risk,
          event.reasonCode,
          event.correlationId,
          event.safeDiffJson,
        ]
          .map(cell)
          .join(','),
      ),
    ];
    const bytes = Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
    const fileId = `file_${exportId}`;
    const storageKey = `exports/${exportId}.csv`;
    await writeCleanFile(storageKey, bytes);
    await this.prisma.$transaction(async (tx) => {
      await tx.fileObject.upsert({
        where: { id: fileId },
        create: {
          id: fileId,
          workspaceId,
          companyId,
          storageKey,
          safeFilename: `bert-audit-${new Date().toISOString().slice(0, 10)}.csv`,
          declaredMime: 'text/csv',
          detectedMime: 'text/csv',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          scanStatus: 'CLEAN',
          ownerId: actorId,
        },
        update: {
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      });
      await tx.fileLink.upsert({
        where: {
          fileId_entityType_entityId_purpose: {
            fileId,
            entityType: 'AUDIT_EXPORT',
            entityId: exportId,
            purpose: 'EXPORT',
          },
        },
        create: {
          id: id('fl'),
          fileId,
          entityType: 'AUDIT_EXPORT',
          entityId: exportId,
          purpose: 'EXPORT',
          aclMode: 'OWNER',
        },
        update: {},
      });
      await tx.auditEvent.create({
        data: {
          id: id('aud'),
          workspaceId,
          companyId,
          actorType: 'USER',
          actorId,
          action: 'audit.export_completed',
          entityType: 'AUDIT_EXPORT',
          entityId: exportId,
          result: 'SUCCESS',
          risk: 'HIGH',
          safeDiffJson: JSON.stringify({
            fileId,
            rows: events.length,
            expiresInHours: 24,
          }),
          correlationId: id('corr'),
        },
      });
    });
  }
}
