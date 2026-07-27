import { Module } from '@nestjs/common'
import { FeedModule } from '../feed/feed.module.js'
import { FilesModule } from '../files/files.module.js'
import { TasksController } from './tasks.controller.js'
import { TasksService } from './tasks.service.js'

@Module({
  imports: [FeedModule, FilesModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
