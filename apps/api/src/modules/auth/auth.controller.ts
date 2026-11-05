import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Request, Response } from 'express'
import { loginInputSchema } from '@lankadws/contracts'
import { z } from 'zod'
import type { LankaDWSRequest } from '../../common/request-context.js'
import { principalFrom } from '../../common/request-context.js'
import { badRequest } from '../../common/errors.js'
import { AuthService } from './auth.service.js'
import { Public, Restricted } from './auth.decorators.js'
import { getConfig } from '../../config/config.js'
import { FilesService, type UploadedBinary } from '../files/files.service.js'

const withoutWhitespace = (value: string) => value.replace(/\s+/gu, '')
const passwordChangeSchema = z.object({ newPassword: z.string().transform(withoutWhitespace), confirmation: z.string().transform(withoutWhitespace) })
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) })
const recoverySchema = z.object({ code: z.string().min(8).max(64) })
const reauthSchema = z.object({ password: z.string().transform(withoutWhitespace).pipe(z.string().min(1)), code: z.string().regex(/^\d{6}$/).optional() })
const profileSchema = z.object({ contactEmail: z.string().email().max(254).nullable(), phone: z.string().trim().max(32).nullable(), gender: z.enum(['FEMALE', 'MALE', 'OTHER']).nullable(), birthDate: z.string().date().nullable(), timezone: z.string().min(3).max(64), locale: z.enum(['uk-UA', 'en-US']) })
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
  async firstLogin(@Body() body: unknown, @Req() request: LankaDWSRequest, @Res({ passthrough: true }) response: Response) {
    const value = parse(passwordChangeSchema, body)
    await this.auth.completeFirstLogin(principalFrom(request), value.newPassword, value.confirmation, response)
    return { changed: true }
  }

  @Restricted()
  @Post('2fa/setup')
  setup(@Req() request: LankaDWSRequest) {
    return this.auth.startTotpSetup(principalFrom(request))
  }

  @Restricted()
  @Post('2fa/confirm')
  confirm(@Body() body: unknown, @Req() request: LankaDWSRequest, @Res({ passthrough: true }) response: Response) {
    return this.auth.confirmTotp(principalFrom(request), parse(codeSchema, body).code, request, response)
  }

  @Restricted()
  @Post('2fa/challenge')
  challenge(@Body() body: unknown, @Req() request: LankaDWSRequest, @Res({ passthrough: true }) response: Response) {
    return this.auth.challengeTotp(principalFrom(request), parse(codeSchema, body).code, request, response)
  }

  @Restricted()
  @Post('recovery-code')
  recovery(@Body() body: unknown, @Req() request: LankaDWSRequest, @Res({ passthrough: true }) response: Response) {
    return this.auth.useRecoveryCode(principalFrom(request), parse(recoverySchema, body).code, request, response)
  }

  @Post('reauth')
  reauth(@Body() body: unknown, @Req() request: LankaDWSRequest) {
    const value = parse(reauthSchema, body)
    return this.auth.reauthenticate(principalFrom(request), value.password, value.code)
  }

  @Post('logout')
  async logout(@Req() request: LankaDWSRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(principalFrom(request), response)
    return { loggedOut: true }
  }
}

@Controller('me')
export class MeController {
  constructor(private readonly auth: AuthService, private readonly files: FilesService) {}

  @Restricted()
  @Get()
  me(@Req() request: LankaDWSRequest) {
    return this.auth.me(principalFrom(request), request.cookies?.lankadws_csrf as string ?? '')
  }

  @Patch('profile')
  profile(@Body() body: unknown, @Req() request: LankaDWSRequest) {
    return this.auth.updateProfile(principalFrom(request), parse(profileSchema, body))
  }

  @Post('avatar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: Math.min(getConfig().MAX_UPLOAD_BYTES, 2 * 1024 * 1024), files: 1 } }))
  async uploadAvatar(@Req() request: LankaDWSRequest, @UploadedFile() file: UploadedBinary) {
    const principal = principalFrom(request)
    if (!file?.mimetype.startsWith('image/')) throw badRequest('avatar_type')
    const uploaded = await this.files.uploadAvatar(principal, file)
    return this.auth.updateAvatar(principal, uploaded.id)
  }

  @Get('avatar/:fileId')
  async avatar(@Param('fileId') fileId: string, @Req() request: LankaDWSRequest, @Res() response: Response) {
    const file = await this.files.downloadAvatar(principalFrom(request), fileId)
    if (!file.mime.startsWith('image/')) throw badRequest('avatar_type')
    response.setHeader('Content-Type', file.mime)
    response.setHeader('Content-Disposition', 'inline')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.send(file.bytes)
  }

  @Delete('avatar')
  removeAvatar(@Req() request: LankaDWSRequest) {
    return this.auth.removeAvatar(principalFrom(request))
  }

  @Get('notification-preferences')
  notificationPreferences(@Req() request: LankaDWSRequest) {
    return this.auth.notificationPreferences(principalFrom(request))
  }

  @Patch('notification-preferences')
  updateNotificationPreferences(@Body() body: unknown, @Req() request: LankaDWSRequest) {
    return this.auth.updateNotificationPreferences(principalFrom(request), parse(notificationPreferenceSchema, body))
  }

  @Get('sessions')
  sessions(@Req() request: LankaDWSRequest) {
    return this.auth.sessions(principalFrom(request))
  }

  @Delete('sessions/:id')
  async revoke(@Param('id') sessionId: string, @Req() request: LankaDWSRequest) {
    await this.auth.revokeSession(principalFrom(request), sessionId)
    return { revoked: true }
  }

  @Post('sessions/revoke-others')
  async revokeOthers(@Req() request: LankaDWSRequest) {
    await this.auth.revokeOthers(principalFrom(request))
    return { revoked: true }
  }
}
