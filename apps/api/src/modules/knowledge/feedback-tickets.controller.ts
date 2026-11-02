import { Body, Controller, Delete, Get, Param, Post, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { getConfig } from '../../config/config.js'
import { FilesService, type UploadedBinary } from '../files/files.service.js'
import { FeedbackTicketsService } from './feedback-tickets.service.js'

@Controller('knowledge/tickets')
export class FeedbackTicketsController {
  constructor(private readonly tickets: FeedbackTicketsService, private readonly files: FilesService) {}

  @Post('attachments')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: getConfig().MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@Req() request: LankaDWSRequest, @UploadedFile() file: UploadedBinary) {
    return this.files.uploadFeedbackAttachment(principalFrom(request), file)
  }

  @Post()
  create(@Req() request: LankaDWSRequest, @Body() body: unknown) {
    return this.tickets.create(principalFrom(request), body)
  }

  @Get()
  list(@Req() request: LankaDWSRequest, @Query('cursor') cursor?: string) {
    return this.tickets.list(principalFrom(request), cursor)
  }

  @Get(':id')
  detail(@Req() request: LankaDWSRequest, @Param('id') id: string) {
    return this.tickets.detail(principalFrom(request), id)
  }

  @Delete(':id')
  remove(@Req() request: LankaDWSRequest, @Param('id') id: string) {
    return this.tickets.remove(principalFrom(request), id)
  }
}
