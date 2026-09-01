import type { INestApplication } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import cookieParser from 'cookie-parser'
import type { NextFunction, Request, Response } from 'express'
import helmet from 'helmet'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { getConfig } from './config/config.js'
import { requestObservability } from './common/observability.js'

export function configureApp(app: INestApplication): void {
  const config = getConfig()
  app.setGlobalPrefix('api/v1')
  app.use(cookieParser())
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  }))
  app.use((request: Request & { correlationId?: string }, response: Response, next: NextFunction) => {
    const incoming = request.header('x-correlation-id')
    request.correlationId = incoming && /^[a-zA-Z0-9_-]{8,80}$/.test(incoming) ? incoming : randomUUID()
    response.setHeader('x-correlation-id', request.correlationId)
    next()
  })
  app.use(requestObservability)
  app.enableCors({ origin: config.FRONTEND_ORIGIN.split(',').map((value) => value.trim()), credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'], allowedHeaders: ['content-type', 'x-csrf-token', 'x-reauth-challenge', 'idempotency-key', 'x-correlation-id'] })
  if (config.TRUSTED_PROXY === 'true') {
    const server = app.getHttpAdapter().getInstance() as { set(name: string, value: number): void }
    server.set('trust proxy', 1)
  }
  const swagger = new DocumentBuilder().setTitle('Lanka API').setDescription('Lanka modular monolith API').setVersion('1.0.0').addCookieAuth(config.SESSION_COOKIE_NAME).build()
  const document = SwaggerModule.createDocument(app, swagger)
  SwaggerModule.setup('api/v1/openapi', app, document, { jsonDocumentUrl: 'api/v1/openapi.json' })
}
