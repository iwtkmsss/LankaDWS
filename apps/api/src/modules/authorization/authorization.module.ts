import { Global, Module } from '@nestjs/common'
import { ScopeService } from './scope.service.js'
import { CapabilitiesService } from './capabilities.service.js'
import { TaskAccessService } from './task-access.service.js'

@Global()
@Module({
  providers: [ScopeService, CapabilitiesService, TaskAccessService],
  exports: [ScopeService, CapabilitiesService, TaskAccessService],
})
export class AuthorizationModule {}
