import { Controller, Delete, Get, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import * as archiver from 'archiver'
import { createCleanFileReadStream } from './storage.js'
import type { Response } from 'express'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { getConfig } from '../../config/config.js'
import { FilesService } from './files.service.js'
import type { UploadedBinary } from './files.service.js'

@Controller('files')
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: getConfig().MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@Req() request: LankaDWSRequest, @Query('company') company: string | undefined, @UploadedFile() file: UploadedBinary) {
    return this.files.upload(principalFrom(request), company, file)
  }

  @Get('archive')
  async archive(@Req() request: LankaDWSRequest, @Query('ids') ids: string | undefined, @Res() response: Response) {
    const files = await this.files.archiveFiles(principalFrom(request), ids?.split(',').filter(Boolean) ?? [])
    response.setHeader('Content-Type', 'application/zip')
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('Файли.zip')}`)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    const zip = new archiver.ZipArchive({ zlib: { level: 6 } })
    zip.on('error', () => response.destroy())
    response.on('close', () => { if (!response.writableFinished) zip.abort() })
    zip.pipe(response)
    for (const file of files) zip.append(createCleanFileReadStream(file.storageKey), { name: file.name })
    await zip.finalize()
  }

  @Get(':id/status')
  status(@Req() request: LankaDWSRequest, @Param('id') id: string) {
    return this.files.status(principalFrom(request), id)
  }

  @Delete(':id/draft')
  discardDraft(@Req() request: LankaDWSRequest, @Param('id') id: string) {
    return this.files.discardStagedAttachment(principalFrom(request), id)
  }

  @Get(':id/download')
  async download(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Query('inline') inline: string | undefined,
    @Res() response: Response,
  ) {
    const file = await this.files.download(principalFrom(request), id)
    const canOpenInline = inline === 'true' && (
      /^image\/(?:png|jpeg|gif|webp)$/.test(file.mime)
      || file.mime === 'application/pdf'
    )
    response.setHeader('Content-Type', file.mime)
    response.setHeader('Content-Disposition', `${canOpenInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.send(file.bytes)
  }
}
