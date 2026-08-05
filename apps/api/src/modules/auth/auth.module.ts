import { Module } from '@nestjs/common'
import { AuthController, MeController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { FilesModule } from '../files/files.module.js'

@Module({
  controllers: [AuthController, MeController],
  imports: [FilesModule],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
