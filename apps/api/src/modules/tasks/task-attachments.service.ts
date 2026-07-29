import { Injectable } from '@nestjs/common'
import { id } from '../../common/crypto.js'
import { badRequest } from '../../common/errors.js'
import type { AuthPrincipal } from '../../common/request-context.js'
import type { UploadedBinary } from '../files/files.service.js'
import { FilesService } from '../files/files.service.js'
import type { TaskTransaction } from './task-types.js'

@Injectable()
export class TaskAttachmentsService {
  constructor(private readonly files: FilesService) {}

  stage(principal: AuthPrincipal, file: UploadedBinary) {
    return this.files.stageTaskUpload(principal, file)
  }

  async validateStaged(
    principal: AuthPrincipal,
    companyId: string,
    fileIds: string[],
  ): Promise<string[]> {
    if (new Set(fileIds).size !== fileIds.length) throw badRequest('task_attachment')
    await this.files.assertTaskStagedAttachments(principal, companyId, fileIds)
    return fileIds
  }

  async linkMany(
    tx: TaskTransaction,
    taskId: string,
    fileIds: string[],
  ): Promise<void> {
    if (!fileIds.length) return
    const alreadyLinked = await tx.fileLink.findFirst({
      where: { fileId: { in: fileIds } },
      select: { id: true },
    })
    if (alreadyLinked) throw badRequest('task_attachment')
    await tx.fileLink.createMany({
      data: fileIds.map((fileId) => ({
        id: id('flink'),
        fileId,
        entityType: 'TASK',
        entityId: taskId,
        purpose: 'ATTACHMENT',
        aclMode: 'ENTITY',
      })),
    })
  }
}
