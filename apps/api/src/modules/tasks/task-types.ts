import type {
  CreateTaskInput,
  TaskParticipantInput,
  TaskRelationInput,
  UpdateTaskInput,
} from '@bert-crm/contracts'
import type { Prisma } from '../../generated/prisma/client.js'

export type TaskTransaction = Prisma.TransactionClient

export interface ValidatedTaskContext {
  companyId: string
  groupId: string | null
  projectId: string | null
  parentTaskId: string | null
  reporterId: string
  startsAt: Date | null
  dueAt: Date | null
  participants: TaskParticipantInput[]
  tagIds: string[]
  relations: TaskRelationInput[]
}

export interface CoreCreateTaskInput extends CreateTaskInput {
  reminders: []
  recurrence?: null
  attachmentIds: []
}

export type CoreUpdateTaskInput = UpdateTaskInput

export const taskDetailInclude = {
  createdBy: {
    select: {
      id: true,
      displayName: true,
      avatarAsset: true,
    },
  },
  reporter: {
    select: {
      id: true,
      displayName: true,
      avatarAsset: true,
    },
  },
  group: {
    select: {
      id: true,
      name: true,
    },
  },
  project: {
    select: {
      id: true,
      name: true,
      status: true,
    },
  },
  parent: {
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
    },
  },
  subtasks: {
    where: {
      archivedAt: null,
    },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
    },
    orderBy: [
      { createdAt: 'asc' as const },
      { id: 'asc' as const },
    ],
  },
  participants: {
    where: {
      removedAt: null,
    },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          displayName: true,
          avatarAsset: true,
          jobTitle: true,
        },
      },
    },
    orderBy: [
      { role: 'asc' as const },
      { createdAt: 'asc' as const },
    ],
  },
  checklist: {
    orderBy: {
      position: 'asc' as const,
    },
  },
  tags: {
    include: {
      tag: true,
    },
    orderBy: {
      tagId: 'asc' as const,
    },
  },
  outgoingRelations: {
    include: {
      targetTask: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
  incomingRelations: {
    include: {
      sourceTask: {
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
        },
      },
    },
    orderBy: {
      createdAt: 'asc' as const,
    },
  },
  reminders: {
    where: {
      status: 'ACTIVE' as const,
    },
    orderBy: [
      { remindAt: 'asc' as const },
      { id: 'asc' as const },
    ],
  },
  recurrenceTemplate: true,
  timeEntries: {
    orderBy: [
      { startedAt: 'desc' as const },
      { id: 'desc' as const },
    ],
  },
} satisfies Prisma.TaskInclude

export type TaskDetailRecord = Prisma.TaskGetPayload<{
  include: typeof taskDetailInclude
}>
