import { Controller, Get, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Response } from 'express'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { getConfig } from '../../config/config.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import { FilesService } from './files.service.js'
import type { UploadedBinary } from './files.service.js'

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @RequirePermissions(Permission.DocumentsManage)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: getConfig().MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@Req() request: BertRequest, @Query('company') company: string | undefined, @UploadedFile() file: UploadedBinary) {
    return this.files.upload(principalFrom(request), company, file)
  }

  @Get(':id/status')
  status(@Req() request: BertRequest, @Param('id') id: string) {
    return this.files.status(principalFrom(request), id)
  }

  @Get(':id/download')
  async download(@Req() request: BertRequest, @Param('id') id: string, @Res() response: Response) {
    const file = await this.files.download(principalFrom(request), id)
    response.setHeader('Content-Type', file.mime)
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.send(file.bytes)
  }
}
