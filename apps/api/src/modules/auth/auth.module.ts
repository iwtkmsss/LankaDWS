import { Module } from '@nestjs/common'
import { AuthController, MeController } from './auth.controller.js'
import { AuthService } from './auth.service.js'

@Module({
  controllers: [AuthController, MeController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
