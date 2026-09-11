import { Controller, Get, Req } from '@nestjs/common'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { DashboardService } from './dashboard.service.js'

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  get(@Req() request: LankaDWSRequest) {
    return this.dashboard.get(principalFrom(request))
  }
}
