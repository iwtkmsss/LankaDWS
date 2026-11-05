import { Module } from '@nestjs/common'
import { OrgController } from './org.controller.js'
import { OrgService } from './org.service.js'
import { AdminOrgController } from './admin-org.controller.js'

@Module({ controllers: [OrgController, AdminOrgController], providers: [OrgService] })
export class OrgModule {}
