import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { z } from 'zod'
import { parseBody } from '../../common/validation.js'
import { LifecycleService } from './lifecycle.service.js'

const dateString = z.string().refine((value) => Number.isFinite(Date.parse(value)))
const startProcessBodySchema = z.object({
  companyId: z.string().optional(),
  employeeId: z.string(),
  startAt: dateString,
  endAt: dateString.optional(),
})
const completeProcessBodySchema = z.object({ expectedVersion: z.number().int(), ownershipTransferred: z.boolean() })

@Controller('lifecycle/processes')
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}

  @Get()
  list(@Req() request: LankaDWSRequest, @Query('company') company?: string) {
    return this.lifecycle.list(principalFrom(request), company)
  }

  @Get(':id')
  detail(@Req() request: LankaDWSRequest, @Param('id') id: string) {
    return this.lifecycle.detail(principalFrom(request), id)
  }

  @Post()
  start(@Req() request: LankaDWSRequest, @Body() body: unknown) {
    return this.lifecycle.start(principalFrom(request), parseBody(startProcessBodySchema, body))
  }

  @Post(':id/complete')
  complete(@Req() request: LankaDWSRequest, @Param('id') id: string, @Body() body: unknown) {
    const input = parseBody(completeProcessBodySchema, body)
    return this.lifecycle.complete(principalFrom(request), id, input.expectedVersion, input.ownershipTransferred)
  }
}
