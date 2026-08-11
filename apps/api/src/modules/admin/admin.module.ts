import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module.js'
import { FilesModule } from '../files/files.module.js'
import { AdminController } from './admin.controller.js'
import { AdminService } from './admin.service.js'

@Module({ imports: [AuthModule, FilesModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}
