import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { loginInputSchema } from '@bert-crm/contracts'
import { z } from 'zod'
import type { BertRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest } from '../../common/errors.js'
import { AuthService } from './auth.service.js'
import { Public, Restricted } from './auth.decorators.js'

const passwordChangeSchema = z.object({ newPassword: z.string(), confirmation: z.string() })
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) })
const recoverySchema = z.object({ code: z.string().min(8).max(64) })
const reauthSchema = z.object({ password: z.string().min(1), code: z.string().regex(/^\d{6}$/).optional() })
const personalPasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(1).max(128), confirmation: z.string().min(1).max(128) })
const profileSchema = z.object({ displayName: z.string().trim().min(2).max(120), jobTitle: z.string().trim().max(120), contactEmail: z.string().email().max(254).nullable(), timezone: z.string().min(3).max(64), locale: z.enum(['uk-UA', 'en-US']) })
const notificationPreferenceSchema = z.object({ emailEnabled: z.boolean(), inAppEnabled: z.literal(true), digest: z.enum(['IMMEDIATE', 'DAILY', 'WEEKLY']), quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw badRequest('validation_failed', result.error.issues[0]?.message)
  return result.data
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() body: unknown, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.auth.login(parse(loginInputSchema, body), request, response)
  }

  @Restricted()
  @Post('first-login/password')
  async firstLogin(@Body() body: unknown, @Req() request: BertRequest, @Res({ passthrough: true }) response: Response) {
    const value = parse(passwordChangeSchema, body)
    await this.auth.completeFirstLogin(principalFrom(request), value.newPassword, value.confirmation, response)
    return { changed: true }
  }

  @Restricted()
  @Post('2fa/setup')
  setup(@Req() request: BertRequest) {
    return this.auth.startTotpSetup(principalFrom(request))
  }

  @Restricted()
  @Post('2fa/confirm')
  confirm(@Body() body: unknown, @Req() request: BertRequest, @Res({ passthrough: true }) response: Response) {
    return this.auth.confirmTotp(principalFrom(request), parse(codeSchema, body).code, request, response)
  }

  @Restricted()
  @Post('2fa/challenge')
  challenge(@Body() body: unknown, @Req() request: BertRequest, @Res({ passthrough: true }) response: Response) {
    return this.auth.challengeTotp(principalFrom(request), parse(codeSchema, body).code, request, response)
  }

  @Restricted()
  @Post('recovery-code')
  recovery(@Body() body: unknown, @Req() request: BertRequest, @Res({ passthrough: true }) response: Response) {
    return this.auth.useRecoveryCode(principalFrom(request), parse(recoverySchema, body).code, request, response)
  }

  @Post('reauth')
  reauth(@Body() body: unknown, @Req() request: BertRequest) {
    const value = parse(reauthSchema, body)
    return this.auth.reauthenticate(principalFrom(request), value.password, value.code)
  }

  @Post('password')
  async changePassword(@Body() body: unknown, @Req() request: BertRequest) {
    const value = parse(personalPasswordSchema, body)
    await this.auth.changePassword(principalFrom(request), value)
    return { changed: true }
  }

  @Post('logout')
  async logout(@Req() request: BertRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(principalFrom(request), response)
    return { loggedOut: true }
  }
}

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Restricted()
  @Get()
  me(@Req() request: BertRequest) {
    return this.auth.me(principalFrom(request), request.cookies?.bert_csrf as string ?? '')
  }

  @Patch('profile')
  profile(@Body() body: unknown, @Req() request: BertRequest) {
    return this.auth.updateProfile(principalFrom(request), parse(profileSchema, body))
  }

  @Get('notification-preferences')
  notificationPreferences(@Req() request: BertRequest) {
    return this.auth.notificationPreferences(principalFrom(request))
  }

  @Patch('notification-preferences')
  updateNotificationPreferences(@Body() body: unknown, @Req() request: BertRequest) {
    return this.auth.updateNotificationPreferences(principalFrom(request), parse(notificationPreferenceSchema, body))
  }

  @Get('sessions')
  sessions(@Req() request: BertRequest) {
    return this.auth.sessions(principalFrom(request))
  }

  @Delete('sessions/:id')
  async revoke(@Param('id') sessionId: string, @Req() request: BertRequest) {
    await this.auth.revokeSession(principalFrom(request), sessionId)
    return { revoked: true }
  }

  @Post('sessions/revoke-others')
  async revokeOthers(@Req() request: BertRequest) {
    await this.auth.revokeOthers(principalFrom(request))
    return { revoked: true }
  }
}
