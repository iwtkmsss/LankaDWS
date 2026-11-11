import { RealtimeModule } from '../realtime/realtime.module.js'
import { Global, Module } from '@nestjs/common'
import { TasksModule } from '../tasks/tasks.module.js'
import { JobsService } from './jobs.service.js'

@Global()
@Module({ imports: [RealtimeModule, TasksModule], providers: [JobsService], exports: [JobsService] })
export class JobsModule {}
