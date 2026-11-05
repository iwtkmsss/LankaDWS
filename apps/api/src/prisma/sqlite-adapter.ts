import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

/** Report the installed SQLite build's actual bind limit instead of Prisma's 999 fallback. */
export class LankaSqliteAdapter extends PrismaBetterSqlite3 {
  override async connect() {
    const adapter = await super.connect()
    const options = await adapter.queryRaw({ sql: 'PRAGMA compile_options', args: [], argTypes: [] })
    const bindOption = options.rows.map((row) => row[0])
      .find((option): option is string => typeof option === 'string' && /^MAX_VARIABLE_NUMBER=\d+$/.test(option))
    if (bindOption) {
      const info = adapter.getConnectionInfo?.()
      const maxBindValues = Number(bindOption.split('=')[1])
      adapter.getConnectionInfo = () => ({ supportsRelationJoins: false, ...info, maxBindValues })
    }
    return adapter
  }
}
