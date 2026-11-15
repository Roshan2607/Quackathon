import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    const host = process.env.SQL_HOST;
    const isUnixSocket = Boolean(host && host.trim().startsWith('/'));
    const isLocalHost = Boolean(
      host && /^(127\.0\.0\.1|localhost|::1)$/i.test(host.trim())
    );
    const port = Number(process.env.SQL_PORT || 5432);
    const sslEnabled =
      !isUnixSocket &&
      !isLocalHost &&
      /^(1|true|require)$/i.test((process.env.SQL_SSL || '').trim());

    global._postgresPool = new Pool({
      host,
      ...(isUnixSocket ? {} : { port }),
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      connectionTimeoutMillis: 15000,
      ssl: sslEnabled ? { rejectUnauthorized: false } : false,
    });

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

export const pool = createPool();

export const db = drizzle(pool, { schema });
