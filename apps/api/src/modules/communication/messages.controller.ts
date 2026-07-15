import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest } from '../../common/errors.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import { MessagesService } from './messages.service.js'

@Controller('messages')
@RequirePermissions(Permission.MessagesRead)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get('threads')
  threads(@Req() request: BertRequest) { return this.messages.threads(principalFrom(request)) }

  @Get('threads/:id')
  detail(@Req() request: BertRequest, @Param('id') id: string) { return this.messages.detail(principalFrom(request), id) }

  @Post('threads/:id/messages')
  post(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { body: string; replyToId?: string }) { return this.messages.post(principalFrom(request), id, body.body, body.replyToId) }

  @Post(':id/task')
  createTask(@Req() request: BertRequest, @Param('id') id: string, @Body() body: { title: string; companyId?: string; assigneeId: string; deadline?: string }, @Headers('idempotency-key') key?: string) {
    if (!key) throw badRequest('idempotency_key_required')
    return this.messages.createTask(principalFrom(request), id, body, key)
  }
}
