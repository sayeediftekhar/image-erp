import { Pool } from 'pg';

declare global {
  // eslint-disable-next-line no-var
  var pgPool: Pool | undefined;
}

// Module-level singleton, reused across hot-reloads in dev via the global reference.
// Each route handler invocation reuses the same pool; connections are returned after each query.
export const pool: Pool =
  global.pgPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgresql:///erp_test?host=/tmp',
  });

if (process.env.NODE_ENV !== 'production') {
  global.pgPool = pool;
}
