import '../src/config/load-env.js'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '../src/generated/prisma/client.js'
import { normalizeUserSearchValue } from '../src/common/user-search.js'
import { getConfig } from '../src/config/config.js'

const batchSize = 250
const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: getConfig().DATABASE_URL }),
})

try {
  let cursor: string | undefined
  for (;;) {
    const users = await prisma.user.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      take: batchSize,
      select: { id: true, displayName: true, normalizedDisplayName: true },
    })
    if (!users.length) break

    await prisma.$transaction(
      users
        .map((user) => ({
          id: user.id,
          value: normalizeUserSearchValue(user.displayName),
          current: user.normalizedDisplayName,
        }))
        .filter((user) => user.value !== user.current)
        .map((user) => prisma.user.update({
          where: { id: user.id },
          data: { normalizedDisplayName: user.value },
        })),
    )
    cursor = users.at(-1)?.id
  }

  const rows = await prisma.user.findMany({
    select: { id: true, displayName: true, normalizedDisplayName: true },
  })
  const invalid = rows.filter(
    (user) => user.normalizedDisplayName !== normalizeUserSearchValue(user.displayName),
  )
  if (invalid.length) {
    throw new Error(`User search backfill left ${invalid.length} non-normalized rows.`)
  }
  process.stdout.write(`User search backfill verified ${rows.length} rows.\n`)
} finally {
  await prisma.$disconnect()
}
