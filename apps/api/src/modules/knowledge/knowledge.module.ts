import { Module } from '@nestjs/common'
import { KnowledgeController } from './knowledge.controller.js'
import { KnowledgeService } from './knowledge.service.js'
import { FilesModule } from '../files/files.module.js'
import { FeedbackTicketsController } from './feedback-tickets.controller.js'
import { FeedbackTicketsService } from './feedback-tickets.service.js'

@Module({ imports: [FilesModule], controllers: [KnowledgeController, FeedbackTicketsController], providers: [KnowledgeService, FeedbackTicketsService], exports: [KnowledgeService] })
export class KnowledgeModule {}
