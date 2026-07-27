import { Controller, Get, Req } from '@nestjs/common'
import { Permission } from '@bert-crm/contracts'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { RequirePermissions } from '../auth/auth.decorators.js'
import { ImportControlService } from './import-control.service.js'

@Controller('admin/import')
@RequirePermissions(Permission.SystemManage)
export class ImportControlController {
  constructor(private readonly imports: ImportControlService) {}

  @Get('readiness')
  readiness(@Req() request: BertRequest) {
    return this.imports.readiness(principalFrom(request))
  }
}
