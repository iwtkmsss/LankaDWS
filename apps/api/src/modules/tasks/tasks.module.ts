import { Module } from '@nestjs/common'
import { DriveSharingModule } from '../documents/drive-sharing.module.js'
import { FeedModule } from '../feed/feed.module.js'
import { FilesModule } from '../files/files.module.js'
import { RealtimeModule } from '../realtime/realtime.module.js'
import { TaskAttachmentsService } from './task-attachments.service.js'
import { TaskCatalogService } from './task-catalog.service.js'
import { TaskChangeSignalInterceptor } from './task-change-signal.interceptor.js'
import { TaskChecklistService } from './task-checklist.service.js'
import { TaskCommandService } from './task-command.service.js'
import { TaskHierarchyService } from './task-hierarchy.service.js'
import { TaskParticipantsService } from './task-participants.service.js'
import { TaskRelationsService } from './task-relations.service.js'
import { TaskRecurrenceService } from './task-recurrence.service.js'
import { TaskReminderService } from './task-reminder.service.js'
import { TaskTimeService } from './task-time.service.js'
import { TaskValidationService } from './task-validation.service.js'
import { TasksController } from './tasks.controller.js'
import { TasksService } from './tasks.service.js'

const taskServices = [
  TaskCatalogService,
  TaskChangeSignalInterceptor,
  TaskAttachmentsService,
  TaskChecklistService,
  TaskCommandService,
  TaskHierarchyService,
  TaskParticipantsService,
  TaskRelationsService,
  TaskRecurrenceService,
  TaskReminderService,
  TaskTimeService,
  TaskValidationService,
]

@Module({
  imports: [DriveSharingModule, FeedModule, FilesModule, RealtimeModule],
  controllers: [TasksController],
  providers: [TasksService, ...taskServices],
  exports: [TasksService, TaskCommandService],
})
export class TasksModule {}
