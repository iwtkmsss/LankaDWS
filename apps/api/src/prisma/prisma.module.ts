import { Global, Module } from '@nestjs/common'
import { PrismaService } from './prisma.service.js'
import { TaskNumberAllocator } from './task-number-allocator.js'

@Global()
@Module({
  providers: [PrismaService, TaskNumberAllocator],
  exports: [PrismaService, TaskNumberAllocator],
})
export class PrismaModule {}
