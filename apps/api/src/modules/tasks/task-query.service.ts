import { Injectable } from '@nestjs/common'
import type { AuthPrincipal } from '../../common/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { TaskAccessService } from '../authorization/task-access.service.js'
import { TaskResponseMapper } from './task-response.mapper.js'
import { taskDetailInclude } from './task-types.js'

@Injectable()
export class TaskQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: TaskAccessService,
    private readonly mapper: TaskResponseMapper,
  ) {}

  async detail(principal: AuthPrincipal, taskId: string) {
    await this.access.readableTask(principal, taskId)
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: taskDetailInclude,
    })
    return this.mapper.detail(principal, task)
  }
}
