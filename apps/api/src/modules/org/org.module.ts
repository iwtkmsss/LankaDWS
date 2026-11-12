import { Module } from '@nestjs/common'
import { RealtimeModule } from '../realtime/realtime.module.js'
import { OrgController } from './org.controller.js'
import { OrgService } from './org.service.js'
import { AdminOrgController } from './admin-org.controller.js'

@Module({ imports: [RealtimeModule], controllers: [OrgController, AdminOrgController], providers: [OrgService] })
export class OrgModule {}
