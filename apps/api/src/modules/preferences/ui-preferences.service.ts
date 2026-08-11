import { Injectable } from '@nestjs/common'
import {
  TASK_DETAIL_PREFERENCE_KEY,
  TASK_DETAIL_PREFERENCE_MODULE,
  TASK_DETAIL_PREFERENCE_SCHEMA_VERSION,
  taskDetailPreferenceValueSchema,
  type PutTaskDetailPreference,
  type UserUiPreferenceResult,
  type UserUiPreferenceView,
} from '@bert-crm/contracts'
import { id } from '../../common/crypto.js'
import { badRequest, conflict } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'

type PreferenceRecord = {
  module: string
  key: string
  schemaVersion: number
  valueJson: string
  version: number
  updatedAt: Date
}

@Injectable()
export class UiPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async getTaskDetail(principal: AuthPrincipal): Promise<UserUiPreferenceResult> {
    const record = await this.prisma.userUiPreference.findUnique({
      where: {
        userId_module_key: {
          userId: principal.userId,
          module: TASK_DETAIL_PREFERENCE_MODULE,
          key: TASK_DETAIL_PREFERENCE_KEY,
        },
      },
    })
    return { preference: record ? this.toView(record) : null }
  }

  async putTaskDetail(
    principal: AuthPrincipal,
    input: PutTaskDetailPreference,
  ): Promise<UserUiPreferenceView> {
    const valueJson = JSON.stringify(input.value)
    if (valueJson.length > 4_000) throw badRequest('ui_preference_size')

    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const current = await tx.userUiPreference.findUnique({
          where: {
            userId_module_key: {
              userId: principal.userId,
              module: TASK_DETAIL_PREFERENCE_MODULE,
              key: TASK_DETAIL_PREFERENCE_KEY,
            },
          },
        })

        if (!current) {
          if (input.expectedVersion !== 0) throw conflict('ui_preference_version')
          return tx.userUiPreference.create({
            data: {
              id: id('uip'),
              userId: principal.userId,
              module: TASK_DETAIL_PREFERENCE_MODULE,
              key: TASK_DETAIL_PREFERENCE_KEY,
              schemaVersion: input.schemaVersion,
              valueJson,
            },
          })
        }

        if (current.version !== input.expectedVersion) throw conflict('ui_preference_version')
        const updated = await tx.userUiPreference.updateMany({
          where: { id: current.id, userId: principal.userId, version: input.expectedVersion },
          data: {
            schemaVersion: input.schemaVersion,
            valueJson,
            version: { increment: 1 },
          },
        })
        if (updated.count !== 1) throw conflict('ui_preference_version')
        return tx.userUiPreference.findUniqueOrThrow({ where: { id: current.id } })
      })
      return this.toView(record)
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('ui_preference_version')
      throw error
    }
  }

  async resetTaskDetail(principal: AuthPrincipal, expectedVersion: number): Promise<{ deleted: true }> {
    if (expectedVersion === 0) {
      const current = await this.prisma.userUiPreference.findUnique({
        where: {
          userId_module_key: {
            userId: principal.userId,
            module: TASK_DETAIL_PREFERENCE_MODULE,
            key: TASK_DETAIL_PREFERENCE_KEY,
          },
        },
        select: { id: true },
      })
      if (current) throw conflict('ui_preference_version')
      return { deleted: true }
    }
    const deleted = await this.prisma.userUiPreference.deleteMany({
      where: {
        userId: principal.userId,
        module: TASK_DETAIL_PREFERENCE_MODULE,
        key: TASK_DETAIL_PREFERENCE_KEY,
        version: expectedVersion,
      },
    })
    if (deleted.count !== 1) throw conflict('ui_preference_version')
    return { deleted: true }
  }

  private toView(record: PreferenceRecord): UserUiPreferenceView {
    if (
      record.module !== TASK_DETAIL_PREFERENCE_MODULE
      || record.key !== TASK_DETAIL_PREFERENCE_KEY
      || record.schemaVersion !== TASK_DETAIL_PREFERENCE_SCHEMA_VERSION
    ) {
      throw badRequest('ui_preference_schema_version')
    }
    let storedValue: unknown
    try {
      storedValue = JSON.parse(record.valueJson) as unknown
    } catch {
      throw badRequest('ui_preference_stored_payload')
    }
    const parsed = taskDetailPreferenceValueSchema.safeParse(storedValue)
    if (!parsed.success) throw badRequest('ui_preference_stored_payload')
    return {
      module: TASK_DETAIL_PREFERENCE_MODULE,
      key: TASK_DETAIL_PREFERENCE_KEY,
      schemaVersion: TASK_DETAIL_PREFERENCE_SCHEMA_VERSION,
      value: parsed.data,
      version: record.version,
      updatedAt: record.updatedAt.toISOString(),
    }
  }
}
