import type { INestApplication } from '@nestjs/common';

const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';

export function configureApp(app: INestApplication): void {
  const allowedOrigins = (
    process.env.FRONTEND_ORIGIN ?? DEFAULT_FRONTEND_ORIGIN
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.setGlobalPrefix('api');
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
}
