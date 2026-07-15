import { Module } from '@nestjs/common'
import { TasksModule } from '../tasks/tasks.module.js'
import { MessagesController } from './messages.controller.js'
import { MessagesService } from './messages.service.js'
import { NotificationsController } from './notifications.controller.js'
import { SavedViewsController } from './saved-views.controller.js'
import { SearchController } from './search.controller.js'

@Module({ imports: [TasksModule], controllers: [MessagesController, NotificationsController, SavedViewsController, SearchController], providers: [MessagesService] })
export class CommunicationModule {}
