import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module.js'
import { FeedController } from './feed.controller.js'
import { FeedProjectionService } from './feed-projection.service.js'
import { FeedService } from './feed.service.js'

@Module({
  imports: [FilesModule],
  controllers: [FeedController],
  providers: [FeedService, FeedProjectionService],
  exports: [FeedService, FeedProjectionService],
})
export class FeedModule {}
