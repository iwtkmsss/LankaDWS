import '../src/config/load-env.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from '../src/app.module.js'
import { configureApp } from '../src/bootstrap.js'

async function main(): Promise<void> {
  process.env.DISABLE_JOB_WORKER = 'true'
  const app = await NestFactory.create(AppModule, { logger: false })
  try {
    configureApp(app)
    const config = new DocumentBuilder().setTitle('Lanka API').setDescription('Permission-scoped Lanka modular monolith API').setVersion('1.0.0').addCookieAuth('bert_session').build()
    const document = SwaggerModule.createDocument(app, config)
    const target = resolve('../../artifacts/openapi.json')
    await mkdir(resolve('../../artifacts'), { recursive: true })
    await writeFile(target, JSON.stringify(document, null, 2))
    console.log(target)
  } finally { await app.close() }
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1 })
