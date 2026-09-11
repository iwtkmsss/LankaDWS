import { Module } from '@nestjs/common'
import { DriveSharingService } from './drive-sharing.service.js'

@Module({ providers: [DriveSharingService], exports: [DriveSharingService] })
export class DriveSharingModule {}
