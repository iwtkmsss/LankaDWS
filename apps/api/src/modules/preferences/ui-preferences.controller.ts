import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common'
import {
  TASK_DETAIL_PREFERENCE_KEY,
  TASK_DETAIL_PREFERENCE_MODULE,
  TASK_LIST_COLUMNS_PREFERENCE_KEY,
  putTaskDetailPreferenceSchema,
  putTaskListColumnsPreferenceSchema,
  resetTaskDetailPreferenceSchema,
  resetTaskListColumnsPreferenceSchema,
} from '@bert-crm/contracts'
import { badRequest, notFound } from '../../common/errors.js'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { UiPreferencesService } from './ui-preferences.service.js'

@Controller('me/ui-preferences')
export class UiPreferencesController {
  constructor(private readonly preferences: UiPreferencesService) {}

  @Get(':module/:key')
  get(
    @Req() request: BertRequest,
    @Param('module') module: string,
    @Param('key') key: string,
  ) {
    return this.preferenceKind(module, key) === 'detail'
      ? this.preferences.getTaskDetail(principalFrom(request))
      : this.preferences.getTaskListColumns(principalFrom(request))
  }

  @Put(':module/:key')
  put(
    @Req() request: BertRequest,
    @Param('module') module: string,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    if (this.preferenceKind(module, key) === 'detail') {
      const parsed = putTaskDetailPreferenceSchema.safeParse(body)
      if (!parsed.success) throw badRequest('ui_preference_payload', parsed.error.issues[0]?.message)
      return this.preferences.putTaskDetail(principalFrom(request), parsed.data)
    }
    const parsed = putTaskListColumnsPreferenceSchema.safeParse(body)
    if (!parsed.success) throw badRequest('ui_preference_payload', parsed.error.issues[0]?.message)
    return this.preferences.putTaskListColumns(principalFrom(request), parsed.data)
  }

  @Delete(':module/:key')
  reset(
    @Req() request: BertRequest,
    @Param('module') module: string,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    if (this.preferenceKind(module, key) === 'detail') {
      const parsed = resetTaskDetailPreferenceSchema.safeParse(body)
      if (!parsed.success) throw badRequest('ui_preference_payload', parsed.error.issues[0]?.message)
      return this.preferences.resetTaskDetail(principalFrom(request), parsed.data.expectedVersion)
    }
    const parsed = resetTaskListColumnsPreferenceSchema.safeParse(body)
    if (!parsed.success) throw badRequest('ui_preference_payload', parsed.error.issues[0]?.message)
    return this.preferences.resetTaskListColumns(principalFrom(request), parsed.data.expectedVersion)
  }

  private preferenceKind(module: string, key: string): 'detail' | 'list' {
    if (module !== TASK_DETAIL_PREFERENCE_MODULE) throw notFound()
    if (key === TASK_DETAIL_PREFERENCE_KEY) return 'detail'
    if (key === TASK_LIST_COLUMNS_PREFERENCE_KEY) return 'list'
    throw notFound()
  }
}

