import { Controller, Get, Req } from '@nestjs/common'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { AdminOnly } from '../auth/auth.decorators.js'
import { ImportControlService } from './import-control.service.js'

@Controller('admin/import')
@AdminOnly()
export class ImportControlController {
  constructor(private readonly imports: ImportControlService) {}

  @Get('readiness')
  readiness(@Req() request: LankaDWSRequest) {
    return this.imports.readiness(principalFrom(request))
  }
}
