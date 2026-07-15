import { Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { id } from '../../common/crypto.js'
import { badRequest, notFound } from '../../common/errors.js'
import { PrismaService } from '../../prisma/prisma.service.js'

@Controller('saved-views')
export class SavedViewsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Req() request: BertRequest) { return this.prisma.savedView.findMany({ where: { userId: principalFrom(request).userId }, orderBy: [{ module: 'asc' }, { name: 'asc' }] }) }

  @Post()
  save(@Req() request: BertRequest, @Body() body: { module: string; name: string; queryState: Record<string, unknown>; isDefault?: boolean }) {
    const userId = principalFrom(request).userId
    const module = body.module?.trim().toUpperCase()
    const name = body.name?.trim()
    if (!module || !['TASKS', 'REQUESTS', 'DOCUMENTS', 'EMPLOYEES'].includes(module) || !name || name.length > 80 || !body.queryState || typeof body.queryState !== 'object' || Array.isArray(body.queryState)) throw badRequest('saved_view_fields')
    const queryState = JSON.stringify(body.queryState)
    if (queryState.length > 4_000) throw badRequest('saved_view_size')
    return this.prisma.savedView.upsert({ where: { userId_module_name: { userId, module, name } }, create: { id: id('view'), userId, module, name, queryState, isDefault: Boolean(body.isDefault) }, update: { queryState, isDefault: Boolean(body.isDefault), version: { increment: 1 } } })
  }

  @Delete(':id')
  async remove(@Req() request: BertRequest, @Param('id') viewId: string) {
    const result = await this.prisma.savedView.deleteMany({ where: { id: viewId, userId: principalFrom(request).userId } })
    if (!result.count) throw notFound()
    return { deleted: true }
  }
}
