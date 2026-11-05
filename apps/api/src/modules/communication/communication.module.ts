import { Module } from '@nestjs/common'
import { CalendarModule } from '../calendar/calendar.module.js'
import { FilesModule } from '../files/files.module.js'
import { TasksModule } from '../tasks/tasks.module.js'
import { RealtimeModule } from '../realtime/realtime.module.js'
import { MessagesController } from './messages.controller.js'
import { MessagesService } from './messages.service.js'
import { NotificationsController } from './notifications.controller.js'
import { SavedViewsController } from './saved-views.controller.js'
import { SearchController } from './search.controller.js'

@Module({
  imports: [CalendarModule, FilesModule, RealtimeModule, TasksModule],
  controllers: [MessagesController, NotificationsController, SavedViewsController, SearchController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class CommunicationModule {}
