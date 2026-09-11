import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module.js'
import { DocumentsController } from './documents.controller.js'
import { DocumentsService } from './documents.service.js'
import { DriveController } from './drive.controller.js'
import { DriveFoldersService } from './drive-folders.service.js'
import { DriveService } from './drive.service.js'
import { DriveSharingModule } from './drive-sharing.module.js'

@Module({
  imports: [DriveSharingModule, FilesModule],
  controllers: [DocumentsController, DriveController],
  providers: [DocumentsService, DriveService, DriveFoldersService],
})
export class DocumentsModule {}
