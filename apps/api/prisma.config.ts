import './src/config/load-env.js';
import { defineConfig } from 'prisma/config';

// Prisma's schema-engine RPC requires its own INFO startup record. An inherited
// process-wide Rust filter such as RUST_LOG=warn suppresses that record on
// Windows and Prisma reports only `Schema engine error` before opening SQLite.
delete process.env.RUST_LOG;

const databaseUrl =
  process.env.DATABASE_URL ?? 'file:./prisma/dev.db';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
});
