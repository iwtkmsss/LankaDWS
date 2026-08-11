import './config/load-env.js'
import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module.js'
import { configureApp } from './bootstrap.js'
import { getConfig } from './config/config.js'

async function bootstrap(): Promise<void> {
  const config = getConfig()
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  configureApp(app)
  app.enableShutdownHooks()
  await app.listen(config.PORT, config.HOST)
}

void bootstrap()
