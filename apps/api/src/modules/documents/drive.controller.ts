import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common'
import {
  createDriveFolderSchema,
  createDriveShareSchema,
  driveListQuerySchema,
  driveShareTargetTypeSchema,
  importDriveFileSchema,
  moveDriveDocumentSchema,
  moveDriveFolderSchema,
  renameDriveDocumentSchema,
  renameDriveFolderSchema,
} from '@lankadws/contracts'
import { badRequest } from '../../common/errors.js'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { DriveFoldersService } from './drive-folders.service.js'
import { DriveService } from './drive.service.js'
import { DriveSharingService } from './drive-sharing.service.js'

@Controller('drive')
export class DriveController {
  constructor(
    private readonly drive: DriveService,
    private readonly folders: DriveFoldersService,
    private readonly sharing: DriveSharingService,
  ) {}

  @Get()
  list(@Req() request: LankaDWSRequest, @Query() rawQuery: Record<string, unknown>) {
    const parsed = driveListQuerySchema.safeParse(rawQuery)
    if (!parsed.success) throw badRequest('drive_query_invalid')
    return this.drive.list(principalFrom(request), parsed.data)
  }

  @Post('documents/:id/move')
  moveDocument(@Req() request: LankaDWSRequest, @Param('id') documentId: string, @Body() rawBody: unknown) {
    const parsed = moveDriveDocumentSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('drive_document_invalid')
    return this.drive.moveDocument(principalFrom(request), documentId, parsed.data.folderId, parsed.data.expectedVersion)
  }

  @Post('documents/:id/rename')
  renameDocument(@Req() request: LankaDWSRequest, @Param('id') documentId: string, @Body() rawBody: unknown) {
    const parsed = renameDriveDocumentSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('drive_document_invalid')
    return this.drive.renameDocument(principalFrom(request), documentId, parsed.data.name, parsed.data.expectedVersion)
  }

  @Post('import-file')
  importFile(@Req() request: LankaDWSRequest, @Body() rawBody: unknown) {
    const parsed = importDriveFileSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('drive_import_invalid')
    return this.drive.importFile(principalFrom(request), parsed.data)
  }

  @Post('documents/:id/as-attachment')
  asAttachment(@Req() request: LankaDWSRequest, @Param('id') documentId: string) {
    return this.drive.attachmentFromDocument(principalFrom(request), documentId)
  }

  @Post('folders')
  createFolder(@Req() request: LankaDWSRequest, @Body() rawBody: unknown) {
    const parsed = createDriveFolderSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('drive_folder_invalid')
    return this.folders.create(principalFrom(request), parsed.data)
  }

  @Get('folders/:id')
  folderDetail(@Req() request: LankaDWSRequest, @Param('id') folderId: string) {
    return this.folders.detail(principalFrom(request), folderId)
  }

  @Patch('folders/:id')
  renameFolder(@Req() request: LankaDWSRequest, @Param('id') folderId: string, @Body() rawBody: unknown) {
    const parsed = renameDriveFolderSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('drive_folder_invalid')
    return this.folders.rename(principalFrom(request), folderId, parsed.data.name)
  }

  @Post('folders/:id/move')
  moveFolder(@Req() request: LankaDWSRequest, @Param('id') folderId: string, @Body() rawBody: unknown) {
    const parsed = moveDriveFolderSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('drive_folder_invalid')
    return this.folders.move(principalFrom(request), folderId, parsed.data.parentId)
  }

  @Post('folders/:id/trash')
  trashFolder(@Req() request: LankaDWSRequest, @Param('id') folderId: string) {
    return this.folders.trash(principalFrom(request), folderId)
  }

  @Post('folders/:id/restore')
  restoreFolder(@Req() request: LankaDWSRequest, @Param('id') folderId: string) {
    return this.folders.restore(principalFrom(request), folderId)
  }

  @Get('shares')
  listShares(
    @Req() request: LankaDWSRequest,
    @Query('targetType') targetType: string,
    @Query('targetId') targetId: string,
  ) {
    const parsed = driveShareTargetTypeSchema.safeParse(targetType)
    if (!parsed.success || !targetId) throw badRequest('drive_share_query_invalid')
    return this.sharing.list(principalFrom(request), parsed.data, targetId)
  }

  @Post('shares')
  createShare(@Req() request: LankaDWSRequest, @Body() rawBody: unknown) {
    const parsed = createDriveShareSchema.safeParse(rawBody)
    if (!parsed.success) throw badRequest('drive_share_invalid')
    return this.sharing.create(principalFrom(request), parsed.data)
  }

  @Delete('shares/:id')
  revokeShare(@Req() request: LankaDWSRequest, @Param('id') shareId: string) {
    return this.sharing.revoke(principalFrom(request), shareId)
  }
}
