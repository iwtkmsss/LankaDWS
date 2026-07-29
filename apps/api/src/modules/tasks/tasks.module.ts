import { Module } from '@nestjs/common'
import { FeedModule } from '../feed/feed.module.js'
import { FilesModule } from '../files/files.module.js'
import { TaskAttachmentsService } from './task-attachments.service.js'
import { TaskCatalogService } from './task-catalog.service.js'
import { TaskChecklistService } from './task-checklist.service.js'
import { TaskCommandService } from './task-command.service.js'
import { TaskHierarchyService } from './task-hierarchy.service.js'
import { TaskParticipantsService } from './task-participants.service.js'
import { TaskQueryService } from './task-query.service.js'
import { TaskRelationsService } from './task-relations.service.js'
import { TaskRecurrenceService } from './task-recurrence.service.js'
import { TaskReminderService } from './task-reminder.service.js'
import { TaskResponseMapper } from './task-response.mapper.js'
import { TaskTimeService } from './task-time.service.js'
import { TaskValidationService } from './task-validation.service.js'
import { TasksController } from './tasks.controller.js'
import { TasksService } from './tasks.service.js'

const taskServices = [
  TaskCatalogService,
  TaskAttachmentsService,
  TaskChecklistService,
  TaskCommandService,
  TaskHierarchyService,
  TaskParticipantsService,
  TaskQueryService,
  TaskRelationsService,
  TaskRecurrenceService,
  TaskReminderService,
  TaskResponseMapper,
  TaskTimeService,
  TaskValidationService,
]

@Module({
  imports: [FeedModule, FilesModule],
  controllers: [TasksController],
  providers: [TasksService, ...taskServices],
  exports: [TasksService, TaskCommandService, TaskQueryService],
})
export class TasksModule {}
