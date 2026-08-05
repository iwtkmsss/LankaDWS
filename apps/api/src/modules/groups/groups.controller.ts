import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import {
  archiveGroupSchema,
  createGroupSchema,
  decideGroupJoinRequestSchema,
  groupListQuerySchema,
  updateGroupSchema,
} from '@bert-crm/contracts'
import { badRequest } from '../../common/errors.js'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { GroupsService } from './groups.service.js'

@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  list(@Req() request: BertRequest, @Query() rawQuery: Record<string, unknown>) {
    const parsed = groupListQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('groups_query_invalid')
    return this.groups.list(principalFrom(request), parsed.data)
  }

  @Post()
  create(@Req() request: BertRequest, @Body() rawBody: unknown) {
    const parsed = createGroupSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('group_invalid')
    return this.groups.create(principalFrom(request), parsed.data)
  }

  @Get(':id')
  detail(@Req() request: BertRequest, @Param('id') groupId: string, @Query('company') company?: string) {
    return this.groups.detail(principalFrom(request), groupId, company)
  }

  @Patch(':id')
  update(@Req() request: BertRequest, @Param('id') groupId: string, @Body() rawBody: unknown) {
    const parsed = updateGroupSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('group_invalid')
    return this.groups.update(principalFrom(request), groupId, parsed.data)
  }

  @Post(':id/archive')
  archive(@Req() request: BertRequest, @Param('id') groupId: string, @Body() rawBody: unknown) {
    const parsed = archiveGroupSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('group_invalid')
    return this.groups.archive(principalFrom(request), groupId, parsed.data.expectedVersion)
  }

  @Post(':id/join')
  join(@Req() request: BertRequest, @Param('id') groupId: string) {
    return this.groups.join(principalFrom(request), groupId)
  }

  @Post(':id/leave')
  leave(@Req() request: BertRequest, @Param('id') groupId: string) {
    return this.groups.leave(principalFrom(request), groupId)
  }

  @Post(':id/requests/:requestId')
  decideRequest(
    @Req() request: BertRequest,
    @Param('id') groupId: string,
    @Param('requestId') requestId: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = decideGroupJoinRequestSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('group_request_invalid')
    return this.groups.decideRequest(principalFrom(request), groupId, requestId, parsed.data.decision)
  }
}
