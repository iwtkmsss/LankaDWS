import { Module } from '@nestjs/common'
import { CommunicationModule } from '../communication/communication.module.js'
import { FeedModule } from '../feed/feed.module.js'
import { KnowledgeModule } from '../knowledge/knowledge.module.js'
import { TasksModule } from '../tasks/tasks.module.js'
import { DashboardController } from './dashboard.controller.js'
import { DashboardService } from './dashboard.service.js'

@Module({
  imports: [TasksModule, CommunicationModule, FeedModule, KnowledgeModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
