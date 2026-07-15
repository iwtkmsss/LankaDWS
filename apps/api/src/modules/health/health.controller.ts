import { Permission } from '@bert-crm/contracts'
import { Controller, Get } from '@nestjs/common'
import { readFile, readdir, stat, statfs } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { requestMetrics } from '../../common/observability.js'
import { getConfig } from '../../config/config.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { Public, RequirePermissions } from '../auth/auth.decorators.js'
import { storageReady } from '../files/storage.js'

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('live')
  live() { return { status: 'ok' } }

  @Public()
  @Get('ready')
  async ready() {
    await this.prisma.$queryRawUnsafe('SELECT 1 FROM _prisma_migrations LIMIT 1')
    await storageReady()
    getConfig()
    return { status: 'ready' }
  }

  @Get('details')
  @RequirePermissions(Permission.SystemManage)
  async details() {
    const config = getConfig()
    const [jobs, outbox, oldest] = await Promise.all([
      this.prisma.backgroundJob.groupBy({ by: ['state'], _count: { id: true } }),
      this.prisma.outboxEvent.groupBy({ by: ['state'], _count: { id: true } }),
      this.prisma.backgroundJob.findFirst({ where: { state: 'QUEUED' }, orderBy: { runAt: 'asc' }, select: { runAt: true } }),
    ])
    const databasePath = config.DATABASE_URL.startsWith('file:') ? resolve(config.DATABASE_URL.slice(5)) : ''
    const walBytes = databasePath ? await stat(`${databasePath}-wal`).then((value) => value.size).catch(() => 0) : 0
    const disk = await statfs(config.FILE_STORAGE_DIR).catch(() => null)
    let latestBackupAt: string | null = null
    try {
      const directories = (await readdir(config.BACKUP_DIR, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()
      for (const directory of directories) {
        try {
          const manifest = JSON.parse(await readFile(join(config.BACKUP_DIR, directory, 'manifest.json'), 'utf8')) as { createdAt?: string }
          if (manifest.createdAt) { latestBackupAt = manifest.createdAt; break }
        } catch { /* Ignore incomplete copies; operators see backup age as missing. */ }
      }
    } catch { /* Backup destination may be intentionally unavailable during an incident. */ }
    return {
      status: 'ready', requests: requestMetrics(),
      jobs: { byState: Object.fromEntries(jobs.map((row) => [row.state, row._count.id])), oldestQueuedAgeSeconds: oldest ? Math.max(0, Math.floor((Date.now() - oldest.runAt.getTime()) / 1_000)) : 0 },
      outbox: { byState: Object.fromEntries(outbox.map((row) => [row.state, row._count.id])) },
      sqlite: { walBytes },
      storage: { writable: await storageReady(), freeBytes: disk ? disk.bavail * disk.bsize : null },
      backup: { latestAt: latestBackupAt, ageSeconds: latestBackupAt ? Math.max(0, Math.floor((Date.now() - new Date(latestBackupAt).getTime()) / 1_000)) : null },
    }
  }
}
