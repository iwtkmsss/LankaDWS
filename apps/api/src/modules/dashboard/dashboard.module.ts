import { Module } from '@nestjs/common'
import { TasksModule } from '../tasks/tasks.module.js'
import { RequestsModule } from '../requests/requests.module.js'
import { DashboardController } from './dashboard.controller.js'
import { DashboardService } from './dashboard.service.js'

@Module({ imports: [TasksModule, RequestsModule], controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
