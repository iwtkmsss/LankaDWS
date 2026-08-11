import { Body, Controller, Delete, Get, Param, Put, Req } from '@nestjs/common'
import {
  TASK_DETAIL_PREFERENCE_KEY,
  TASK_DETAIL_PREFERENCE_MODULE,
  putTaskDetailPreferenceSchema,
  resetTaskDetailPreferenceSchema,
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
    this.assertTaskDetail(module, key)
    return this.preferences.getTaskDetail(principalFrom(request))
  }

  @Put(':module/:key')
  put(
    @Req() request: BertRequest,
    @Param('module') module: string,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    this.assertTaskDetail(module, key)
    const parsed = putTaskDetailPreferenceSchema.safeParse(body)
    if (!parsed.success) throw badRequest('ui_preference_payload', parsed.error.issues[0]?.message)
    return this.preferences.putTaskDetail(principalFrom(request), parsed.data)
  }

  @Delete(':module/:key')
  reset(
    @Req() request: BertRequest,
    @Param('module') module: string,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    this.assertTaskDetail(module, key)
    const parsed = resetTaskDetailPreferenceSchema.safeParse(body)
    if (!parsed.success) throw badRequest('ui_preference_payload', parsed.error.issues[0]?.message)
    return this.preferences.resetTaskDetail(principalFrom(request), parsed.data.expectedVersion)
  }

  private assertTaskDetail(module: string, key: string): void {
    if (module !== TASK_DETAIL_PREFERENCE_MODULE || key !== TASK_DETAIL_PREFERENCE_KEY) throw notFound()
  }
}

