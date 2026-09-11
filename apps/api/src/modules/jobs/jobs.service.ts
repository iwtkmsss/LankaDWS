import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { id } from '../../common/crypto.js';
import { getConfig } from '../../config/config.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TaskNumberAllocator } from '../../prisma/task-number-allocator.js';
import { writeFeedProjection } from '../feed/feed-projection.service.js';
import { deleteStoredFile, promoteFile, writeCleanFile } from '../files/storage.js';
import {
  nextRecurrenceOccurrence,
  recurrenceJobRunAt,
  recurrenceRelationForOccurrence,
  type RecurrenceRule,
} from '../tasks/task-recurrence.service.js';
import { writeTaskReminders } from '../tasks/task-reminder.service.js';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly taskNumbers: TaskNumberAllocator,
  ) {}

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
          {
            ...payload,
            aggregateVersion: event.aggregateVersion,
          },
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
    if (type === 'file.staged.cleanup') return this.cleanupStagedFile(entityId);
    if (type === 'task.recurrence')
      return this.createRecurringTask(entityId, payload);
    if (type === 'task.reminder') return this.deliverTaskReminder(entityId);
    if ([
      'task.created',
      'task.updated',
      'task.archived',
      'task.recurrence_created',
    ].includes(type)) {
      return this.projectTaskEvent(entityId, type, payload);
    }
    if (type === 'retention.purge') return this.runRetention(entityId, payload);
    if (type === 'export.generate')
      return this.generateAuditExport(entityId, payload);
    if (type === 'search.index' || type === 'document.preview') return;
    throw new Error('UnknownJobType');
  }

  private async materializeAnnouncement(announcementId: string): Promise<void> {
    const announcement = await this.prisma.announcement.findUnique({
      where: { id: announcementId },
      include: { companies: true, users: true },
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
        workspaceId: announcement.workspaceId,
        isActive: true,
        OR: [
          { id: { in: announcement.users.map((entry) => entry.userId) } },
          {
            primaryCompanyId: {
              in: announcement.companies.map((entry) => entry.companyId),
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

  private async cleanupStagedFile(fileId: string): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
      include: {
        feedShares: {
          where: { status: 'ACTIVE' },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!file || file.createdAt > new Date(Date.now() - 86_400_000)) return;
    const link = await this.prisma.fileLink.findFirst({
      where: { fileId },
      select: { id: true },
    });
    if (link || file.feedShares.length) return;
    await deleteStoredFile(file.storageKey);
    await this.prisma.fileObject.delete({ where: { id: fileId } });
  }

  private async projectTaskEvent(
    taskId: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        participants: {
          where: { removedAt: null },
          select: { userId: true },
        },
      },
    });
    if (!task) return;
    const aggregateVersion = Number(payload.aggregateVersion);
    if (!Number.isInteger(aggregateVersion) || aggregateVersion < 1) {
      throw new Error('TaskProjectionVersionInvalid');
    }
    await this.prisma.$transaction((tx) => writeFeedProjection(tx, {
      workspaceId: task.workspaceId,
      companyId: task.companyId,
      sourceType: 'TASK',
      sourceId: task.id,
      sourceVersion: aggregateVersion,
      action: eventType.slice('task.'.length).toUpperCase(),
      actorId: payloadString(payload, 'actorId') || null,
      recipientIds: [
        task.createdById,
        task.reporterId,
        ...task.participants.map((participant) => participant.userId),
      ],
      visibility: 'PARTICIPANTS',
      occurredAt: task.updatedAt,
    }));
  }

  private async createRecurringTask(
    recurrenceId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const recurrence = await this.prisma.taskRecurrence.findUnique({
      where: { id: recurrenceId },
      include: {
        templateTask: {
          include: {
            participants: { where: { removedAt: null } },
            checklist: { orderBy: { position: 'asc' } },
            tags: true,
            reminders: {
              where: {
                status: 'ACTIVE',
                triggerType: { in: ['BEFORE_START', 'BEFORE_DUE'] },
              },
            },
            outgoingRelations: {
              where: { type: { in: ['RELATED', 'DUPLICATES'] } },
            },
            incomingRelations: {
              where: { type: { in: ['RELATED', 'DUPLICATES'] } },
            },
          },
        },
      },
    });
    if (
      !recurrence
      || !recurrence.isActive
      || !recurrence.nextRunAt
      || recurrence.templateTask.archivedAt
      || ['CANCELLED', 'ARCHIVED'].includes(recurrence.templateTask.status)
    )
      return;
    const occurrenceAt = new Date(payloadString(payload, 'occurrenceAt'));
    if (
      Number.isNaN(occurrenceAt.getTime())
      || occurrenceAt.getTime() !== recurrence.nextRunAt.getTime()
    )
      return;
    const source = recurrence.templateTask;
    const existing = await this.prisma.task.findUnique({
      where: {
        recurrenceId_recurrenceOccurrenceAt: {
          recurrenceId,
          recurrenceOccurrenceAt: occurrenceAt,
        },
      },
    });
    let daysOfWeek: number[] = [];
    if (recurrence.daysOfWeekJson) {
      const parsed = JSON.parse(recurrence.daysOfWeekJson) as unknown;
      if (
        !Array.isArray(parsed)
        || parsed.some((day) => !Number.isInteger(day) || day < 1 || day > 7)
      ) {
        throw new Error('RecurrenceWeekdaysInvalid');
      }
      daysOfWeek = parsed as number[];
    }
    const rule: RecurrenceRule = {
      frequency: recurrence.frequency,
      interval: recurrence.interval,
      startsAt: recurrence.startsAt,
      daysOfWeek,
      dayOfMonth: recurrence.dayOfMonth,
      endsAt: recurrence.endsAt,
      maxOccurrences: recurrence.maxOccurrences,
      timezone: recurrence.timezone,
    };
    const generatedOccurrences = recurrence.generatedOccurrences + (existing ? 0 : 1);
    const reachedMaximum = recurrence.maxOccurrences !== null
      && generatedOccurrences >= recurrence.maxOccurrences;
    const nextOccurrenceAt = reachedMaximum
      ? null
      : nextRecurrenceOccurrence(rule, occurrenceAt);
    const maximumReminderOffset = source.reminders.reduce(
      (maximum, reminder) => Math.max(maximum, reminder.offsetMinutes ?? 0),
      0,
    );
    if (!existing) {
      const taskId = id('tsk');
      await this.taskNumbers.runInTransaction(this.prisma, async (tx, number) => {
        const duration = source.startsAt && source.dueAt
          ? source.dueAt.getTime() - source.startsAt.getTime()
          : null;
        const startsAt = source.startsAt ? occurrenceAt : null;
        const dueAt = source.dueAt
          ? new Date(occurrenceAt.getTime() + (duration ?? 0))
          : null;
        const task = await tx.task.create({
          data: {
            id: taskId,
            workspaceId: source.workspaceId,
            companyId: source.companyId,
            groupId: source.groupId,
            projectId: source.projectId,
            number,
            title: source.title,
            description: source.description,
            createdById: source.createdById,
            reporterId: source.reporterId,
            status: 'NEW',
            priority: source.priority,
            startsAt,
            dueAt,
            estimatedMinutes: source.estimatedMinutes,
            recurrenceId,
            recurrenceOccurrenceAt: occurrenceAt,
          },
        });
        if (source.participants.length) {
          await tx.taskParticipant.createMany({
            data: source.participants.map((participant) => ({
              id: id('tpart'),
              taskId,
              userId: participant.userId,
              role: participant.role,
              addedById: source.createdById,
            })),
          });
        }
        if (source.checklist.length) {
          await tx.taskChecklistItem.createMany({
            data: source.checklist.map((item, position) => ({
              id: id('tcheck'),
              taskId,
              title: item.title,
              isCompleted: false,
              position,
            })),
          });
        }
        if (source.tags.length) {
          await tx.taskTag.createMany({
            data: source.tags.map((tag) => ({
              taskId,
              tagId: tag.tagId,
            })),
          });
        }
        const relationRows = [
          ...source.outgoingRelations,
          ...source.incomingRelations,
        ].map((relation) => ({
          id: id('trel'),
          ...recurrenceRelationForOccurrence(source.id, taskId, relation),
          createdById: source.createdById,
        }));
        if (relationRows.length) {
          await tx.taskRelation.createMany({ data: relationRows });
        }
        await writeTaskReminders(
          tx,
          taskId,
          { startsAt, dueAt },
          source.participants.map((participant) => participant.userId),
          source.reminders.flatMap((reminder) => (
            reminder.userId && reminder.offsetMinutes
              ? [{
                  target: { type: 'USER' as const, userId: reminder.userId },
                  trigger: {
                    type: reminder.triggerType,
                    offsetMinutes: reminder.offsetMinutes,
                  } as {
                    type: 'BEFORE_START' | 'BEFORE_DUE'
                    offsetMinutes: number
                  },
                }]
              : []
          )),
          new Date(),
          true,
        );
        await tx.taskRecurrence.update({
          where: { id: recurrenceId },
          data: {
            generatedOccurrences: { increment: 1 },
            nextRunAt: nextOccurrenceAt,
            isActive: Boolean(nextOccurrenceAt),
            version: { increment: 1 },
          },
        });
        if (nextOccurrenceAt) {
          await tx.backgroundJob.create({
            data: {
              id: id('job'),
              type: 'task.recurrence',
              entityType: 'TASK_RECURRENCE',
              entityId: recurrenceId,
              safePayload: JSON.stringify({
                occurrenceAt: nextOccurrenceAt.toISOString(),
              }),
              idempotencyKey: `task-recurrence:${recurrenceId}:${nextOccurrenceAt.toISOString()}`,
              runAt: recurrenceJobRunAt(
                nextOccurrenceAt,
                maximumReminderOffset,
              ),
            },
          });
        }
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
              sourceTaskId: source.id,
              recurrenceId,
              occurrenceAt: occurrenceAt.toISOString(),
            }),
            correlationId: id('corr'),
          },
        });
        await tx.outboxEvent.create({
          data: {
            id: id('out'),
            aggregateType: 'TASK',
            aggregateId: taskId,
            aggregateVersion: task.version,
            eventType: 'task.recurrence_created',
            safePayload: JSON.stringify({
              taskId,
              recurrenceId,
              occurrenceAt: occurrenceAt.toISOString(),
            }),
          },
        });
      });
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
            isActive: true,
            accountType: true,
            primaryCompanyId: true,
            groupMemberships: {
              select: {
                groupId: true,
                leftAt: true,
              },
            },
          },
        },
      },
    });
    if (!reminder || reminder.status !== 'ACTIVE') return;
    const task = reminder.task;
    if (!reminder.user || !reminder.userId) {
      await this.prisma.taskReminder.updateMany({
        where: { id: reminder.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      return;
    }
    const reminderUserId = reminder.userId;
    const hasCompanyAccess = reminder.user.isActive
      && (reminder.user.accountType === 'ADMIN' || reminder.user.primaryCompanyId === task.companyId);
    const hasGroupAccess = !task.groupId
      || reminder.user.groupMemberships.some((membership) => (
        membership.groupId === task.groupId && !membership.leftAt
      ));
    const isDirectActor = task.createdById === reminderUserId
      || task.reporterId === reminderUserId
      || Boolean(await this.prisma.taskParticipant.findFirst({
        where: {
          taskId: task.id,
          userId: reminderUserId,
          removedAt: null,
        },
        select: { id: true },
      }));
    const canManage = reminder.user.accountType === 'ADMIN';
    if (
      task.archivedAt
      || !hasCompanyAccess
      || !hasGroupAccess
      || (!isDirectActor && !canManage)
    ) {
      await this.prisma.taskReminder.updateMany({
        where: { id: reminder.id, status: 'ACTIVE' },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });
      return;
    }
    await this.prisma.$transaction(async (tx) => {
      const sent = await tx.taskReminder.updateMany({
        where: { id: reminder.id, status: 'ACTIVE' },
        data: { status: 'SENT', sentAt: new Date() },
      });
      if (!sent.count) return;
      await tx.notification.upsert({
        where: { dedupeKey: `task-reminder:${reminder.id}:${reminderUserId}` },
        create: {
          id: id('ntf'),
          recipientId: reminderUserId,
          category: 'TASKS',
          safeTitle: 'Нагадування про завдання',
          safeSnippet: `${task.number} · ${task.title}`.slice(0, 180),
          entityType: 'TASK',
          entityId: task.id,
          requiresAction: true,
          deliveredAt: new Date(),
          dedupeKey: `task-reminder:${reminder.id}:${reminderUserId}`,
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
    if (!workspaceId || !actorId)
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
          companyId: companyId || null,
          storageKey,
          safeFilename: `lankadws-audit-${new Date().toISOString().slice(0, 10)}.csv`,
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
          companyId: companyId || null,
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
