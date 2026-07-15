import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../generated/prisma/client.js'
import { getConfig } from '../config/config.js'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaBetterSqlite3({ url: getConfig().DATABASE_URL }) })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
    await this.$executeRawUnsafe('PRAGMA foreign_keys = ON')
    await this.$executeRawUnsafe('PRAGMA journal_mode = WAL')
    await this.$executeRawUnsafe('PRAGMA synchronous = FULL')
    await this.$executeRawUnsafe('PRAGMA busy_timeout = 5000')
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
