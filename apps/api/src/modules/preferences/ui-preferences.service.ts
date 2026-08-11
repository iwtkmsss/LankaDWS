import { Injectable } from '@nestjs/common'
import {
  TASK_DETAIL_PREFERENCE_KEY,
  TASK_DETAIL_PREFERENCE_MODULE,
  TASK_DETAIL_PREFERENCE_SCHEMA_VERSION,
  TASK_LIST_COLUMNS_PREFERENCE_KEY,
  TASK_LIST_COLUMNS_PREFERENCE_SCHEMA_VERSION,
  taskDetailPreferenceValueSchema,
  taskListColumnsPreferenceValueSchema,
  type PutTaskDetailPreference,
  type PutTaskListColumnsPreference,
  type TaskListColumnsUserUiPreferenceResult,
  type TaskListColumnsUserUiPreferenceView,
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
    const record = await this.find(principal, TASK_DETAIL_PREFERENCE_KEY)
    return { preference: record ? this.toView(record) : null }
  }

  async getTaskListColumns(principal: AuthPrincipal): Promise<TaskListColumnsUserUiPreferenceResult> {
    const record = await this.find(principal, TASK_LIST_COLUMNS_PREFERENCE_KEY)
    return { preference: record ? this.toTaskListColumnsView(record) : null }
  }

  async putTaskDetail(
    principal: AuthPrincipal,
    input: PutTaskDetailPreference,
  ): Promise<UserUiPreferenceView> {
    return this.toView(await this.put(principal, TASK_DETAIL_PREFERENCE_KEY, input))
  }

  async putTaskListColumns(
    principal: AuthPrincipal,
    input: PutTaskListColumnsPreference,
  ): Promise<TaskListColumnsUserUiPreferenceView> {
    return this.toTaskListColumnsView(await this.put(principal, TASK_LIST_COLUMNS_PREFERENCE_KEY, input))
  }

  async resetTaskDetail(principal: AuthPrincipal, expectedVersion: number): Promise<{ deleted: true }> {
    return this.reset(principal, TASK_DETAIL_PREFERENCE_KEY, expectedVersion)
  }

  async resetTaskListColumns(principal: AuthPrincipal, expectedVersion: number): Promise<{ deleted: true }> {
    return this.reset(principal, TASK_LIST_COLUMNS_PREFERENCE_KEY, expectedVersion)
  }

  private async find(principal: AuthPrincipal, key: string): Promise<PreferenceRecord | null> {
    return this.prisma.userUiPreference.findUnique({
      where: { userId_module_key: { userId: principal.userId, module: TASK_DETAIL_PREFERENCE_MODULE, key } },
    })
  }

  private async put(
    principal: AuthPrincipal,
    key: string,
    input: { schemaVersion: number; value: unknown; expectedVersion: number },
  ): Promise<PreferenceRecord> {
    const valueJson = JSON.stringify(input.value)
    if (valueJson.length > 4_000) throw badRequest('ui_preference_size')
    try {
      return await this.prisma.$transaction(async (tx) => {
        const current = await tx.userUiPreference.findUnique({
          where: { userId_module_key: { userId: principal.userId, module: TASK_DETAIL_PREFERENCE_MODULE, key } },
        })
        if (!current) {
          if (input.expectedVersion !== 0) throw conflict('ui_preference_version')
          return tx.userUiPreference.create({
            data: { id: id('uip'), userId: principal.userId, module: TASK_DETAIL_PREFERENCE_MODULE, key, schemaVersion: input.schemaVersion, valueJson },
          })
        }
        if (current.version !== input.expectedVersion) throw conflict('ui_preference_version')
        const updated = await tx.userUiPreference.updateMany({
          where: { id: current.id, userId: principal.userId, version: input.expectedVersion },
          data: { schemaVersion: input.schemaVersion, valueJson, version: { increment: 1 } },
        })
        if (updated.count !== 1) throw conflict('ui_preference_version')
        return tx.userUiPreference.findUniqueOrThrow({ where: { id: current.id } })
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw conflict('ui_preference_version')
      throw error
    }
  }

  private async reset(principal: AuthPrincipal, key: string, expectedVersion: number): Promise<{ deleted: true }> {
    if (expectedVersion === 0) {
      const current = await this.prisma.userUiPreference.findUnique({
        where: { userId_module_key: { userId: principal.userId, module: TASK_DETAIL_PREFERENCE_MODULE, key } },
        select: { id: true },
      })
      if (current) throw conflict('ui_preference_version')
      return { deleted: true }
    }
    const deleted = await this.prisma.userUiPreference.deleteMany({
      where: {
        userId: principal.userId,
        module: TASK_DETAIL_PREFERENCE_MODULE,
        key,
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

  private toTaskListColumnsView(record: PreferenceRecord): TaskListColumnsUserUiPreferenceView {
    if (
      record.module !== TASK_DETAIL_PREFERENCE_MODULE
      || record.key !== TASK_LIST_COLUMNS_PREFERENCE_KEY
      || record.schemaVersion !== TASK_LIST_COLUMNS_PREFERENCE_SCHEMA_VERSION
    ) throw badRequest('ui_preference_schema_version')
    let storedValue: unknown
    try {
      storedValue = JSON.parse(record.valueJson) as unknown
    } catch {
      throw badRequest('ui_preference_stored_payload')
    }
    const parsed = taskListColumnsPreferenceValueSchema.safeParse(storedValue)
    if (!parsed.success) throw badRequest('ui_preference_stored_payload')
    return {
      module: TASK_DETAIL_PREFERENCE_MODULE,
      key: TASK_LIST_COLUMNS_PREFERENCE_KEY,
      schemaVersion: TASK_LIST_COLUMNS_PREFERENCE_SCHEMA_VERSION,
      value: parsed.data,
      version: record.version,
      updatedAt: record.updatedAt.toISOString(),
    }
  }
}
