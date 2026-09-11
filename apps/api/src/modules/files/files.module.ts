import { Module } from '@nestjs/common'
import { DriveSharingModule } from '../documents/drive-sharing.module.js'
import { FilesController } from './files.controller.js'
import { FilesService } from './files.service.js'

@Module({
  imports: [DriveSharingModule],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
