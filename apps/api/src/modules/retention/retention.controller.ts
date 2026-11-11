import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import { badRequest } from '../../common/errors.js';
import { parseBody } from '../../common/validation.js';
import type { LankaDWSRequest } from '../../common/request-context.js';
import { principalFrom } from '../../common/request-context.js';
import { AdminOnly } from '../auth/auth.decorators.js';
import { RetentionService } from './retention.service.js';

// Structural shape only; the service keeps its specific blank-reason and range checks.
const updatePolicyBodySchema = z.object({
  expectedVersion: z.number().int(),
  durationDays: z.number(),
  effectiveAt: z.string(),
  reason: z.string(),
});
const placeHoldBodySchema = z.object({ entityType: z.string(), entityId: z.string(), reason: z.string() });
const releaseHoldBodySchema = z.object({ reason: z.string() });
const purgeBodySchema = z.object({
  category: z.string(),
  cutoff: z.string().optional(),
  expectedCount: z.number().int(),
  reason: z.string(),
});

@Controller('admin/retention')
@AdminOnly()
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Get()
  overview(@Req() request: LankaDWSRequest) {
    return this.retention.overview(principalFrom(request));
  }

  @Patch('policies/:category')
  updatePolicy(
    @Req() request: LankaDWSRequest,
    @Param('category') category: string,
    @Body() body: unknown,
    @Headers('x-reauth-challenge') reauth?: string,
  ) {
    return this.retention.updatePolicy(
      principalFrom(request),
      category,
      parseBody(updatePolicyBodySchema, body),
      reauth,
    );
  }

  @Post('legal-holds')
  placeHold(
    @Req() request: LankaDWSRequest,
    @Body() body: unknown,
    @Headers('x-reauth-challenge') reauth?: string,
  ) {
    return this.retention.placeHold(principalFrom(request), parseBody(placeHoldBodySchema, body), reauth);
  }

  @Post('legal-holds/:id/release')
  releaseHold(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Body() body: unknown,
    @Headers('x-reauth-challenge') reauth?: string,
  ) {
    return this.retention.releaseHold(
      principalFrom(request),
      id,
      parseBody(releaseHoldBodySchema, body).reason,
      reauth,
    );
  }

  @Get('dry-run')
  dryRun(
    @Req() request: LankaDWSRequest,
    @Query('category') category = '',
    @Query('cutoff') cutoff?: string,
  ) {
    return this.retention.dryRun(principalFrom(request), category, cutoff);
  }

  @Post('purge')
  purge(
    @Req() request: LankaDWSRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') key?: string,
    @Headers('x-reauth-challenge') reauth?: string,
  ) {
    if (!key) throw badRequest('idempotency_key_required');
    return this.retention.purge(principalFrom(request), parseBody(purgeBodySchema, body), key, reauth);
  }
}
