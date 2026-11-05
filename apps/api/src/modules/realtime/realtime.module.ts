import { Module } from '@nestjs/common'
import { ChatRealtimeService } from '../communication/chat-realtime.service.js'

@Module({
  providers: [ChatRealtimeService],
  exports: [ChatRealtimeService],
})
export class RealtimeModule {}
