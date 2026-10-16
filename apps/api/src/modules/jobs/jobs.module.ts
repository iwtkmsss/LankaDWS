import { RealtimeModule } from '../realtime/realtime.module.js'
import { Global, Module } from '@nestjs/common'
import { JobsService } from './jobs.service.js'

@Global()
@Module({ imports: [RealtimeModule], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
