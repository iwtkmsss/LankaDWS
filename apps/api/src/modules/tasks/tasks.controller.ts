import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest } from '../../common/errors.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import { TasksService, type CreateTaskInput } from './tasks.service.js'

@Controller('tasks')
@RequirePermissions(Permission.TasksRead)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  list(@Req() request: BertRequest, @Query('company') company?: string, @Query('segment') segment?: string, @Query('page') page?: string, @Query('search') search?: string, @Query('status') status?: string, @Query('priority') priority?: string) {
    return this.tasks.list(principalFrom(request), company, segment, Number(page ?? 1), 25, { search, status, priority })
  }

  @Get(':id')
  detail(@Req() request: BertRequest, @Param('id') taskId: string) {
    return this.tasks.detail(principalFrom(request), taskId)
  }

  @Post()
  @RequirePermissions(Permission.TasksCreate)
  create(@Req() request: BertRequest, @Body() body: CreateTaskInput, @Headers('idempotency-key') key?: string) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.tasks.create(principalFrom(request), body, key)
  }

  @Patch(':id/status')
  changeStatus(@Req() request: BertRequest, @Param('id') taskId: string, @Body() body: { status: string; expectedVersion: number }) {
    return this.tasks.changeStatus(principalFrom(request), taskId, body.status, body.expectedVersion)
  }

  @Post(':id/comments')
  comment(@Req() request: BertRequest, @Param('id') taskId: string, @Body() body: { body: string }) {
    return this.tasks.addComment(principalFrom(request), taskId, body.body)
  }

  @Post(':id/checklist')
  checklistItem(@Req() request: BertRequest, @Param('id') taskId: string, @Body() body: { text: string }) {
    return this.tasks.addChecklistItem(principalFrom(request), taskId, body.text)
  }

  @Patch(':id/checklist/:itemId')
  checklistState(@Req() request: BertRequest, @Param('id') taskId: string, @Param('itemId') itemId: string, @Body() body: { isDone: boolean; expectedVersion: number }) {
    return this.tasks.updateChecklistItem(principalFrom(request), taskId, itemId, body)
  }

  @Post(':id/recurrence')
  recurrence(@Req() request: BertRequest, @Param('id') taskId: string, @Body() body: { frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY'; interval: number; firstOccurrenceAt: string; until?: string }) {
    return this.tasks.scheduleRecurrence(principalFrom(request), taskId, body)
  }
}
