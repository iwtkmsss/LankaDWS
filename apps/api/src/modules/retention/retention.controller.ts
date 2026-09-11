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
import { badRequest } from '../../common/errors.js';
import type { LankaDWSRequest } from '../../common/request-context.js';
import { principalFrom } from '../../common/request-context.js';
import { AdminOnly } from '../auth/auth.decorators.js';
import { RetentionService } from './retention.service.js';

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
    @Body()
    body: {
      expectedVersion: number;
      durationDays: number;
      effectiveAt: string;
      reason: string;
    },
    @Headers('x-reauth-challenge') reauth?: string,
  ) {
    return this.retention.updatePolicy(
      principalFrom(request),
      category,
      body,
      reauth,
    );
  }

  @Post('legal-holds')
  placeHold(
    @Req() request: LankaDWSRequest,
    @Body() body: { entityType: string; entityId: string; reason: string },
    @Headers('x-reauth-challenge') reauth?: string,
  ) {
    return this.retention.placeHold(principalFrom(request), body, reauth);
  }

  @Post('legal-holds/:id/release')
  releaseHold(
    @Req() request: LankaDWSRequest,
    @Param('id') id: string,
    @Body() body: { reason: string },
    @Headers('x-reauth-challenge') reauth?: string,
  ) {
    return this.retention.releaseHold(
      principalFrom(request),
      id,
      body.reason,
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
    @Body()
    body: {
      category: string;
      cutoff?: string;
      expectedCount: number;
      reason: string;
    },
    @Headers('idempotency-key') key?: string,
    @Headers('x-reauth-challenge') reauth?: string,
  ) {
    if (!key) throw badRequest('idempotency_key_required');
    return this.retention.purge(principalFrom(request), body, key, reauth);
  }
}
