import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config();

const sqlHost = process.env.SQL_HOST;
const sqlPort = Number(process.env.SQL_PORT || 5432);
const sqlDbName = process.env.SQL_DB_NAME;
// SQL_ADMIN_USER / SQL_ADMIN_PASSWORD are optional: they allow running DDL
// with a privileged role while the app itself connects with SQL_USER.
const user = process.env.SQL_ADMIN_USER || process.env.SQL_USER;
const password = process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD;
const sslEnabled = /^(1|true|require)$/i.test(
  (process.env.SQL_SSL || '').trim()
);

if (!sqlHost) {
  throw new Error('SQL_HOST must be set in environment variables.');
}
if (!sqlDbName) {
  throw new Error('SQL_DB_NAME must be set in environment variables.');
}
if (!user) {
  throw new Error('SQL_USER (or SQL_ADMIN_USER) must be set in environment variables.');
}
if (!password) {
  throw new Error(
    'SQL_PASSWORD (or SQL_ADMIN_PASSWORD) must be set in environment variables.'
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  dbCredentials: {
    host: sqlHost,
    port: sqlPort,
    user: user,
    password: password,
    database: sqlDbName,
    ssl: sslEnabled ? 'require' : false,
  },
  verbose: true,
});
