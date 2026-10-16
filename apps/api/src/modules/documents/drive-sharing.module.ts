import { Module } from '@nestjs/common'
import { DriveSharingService } from './drive-sharing.service.js'
import { RealtimeModule } from '../realtime/realtime.module.js'

@Module({ imports: [RealtimeModule], providers: [DriveSharingService], exports: [DriveSharingService] })
export class DriveSharingModule {}
