import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let pool: ReturnType<typeof postgres> | undefined;
let dbInstance: Database | undefined;

export function getDb(databaseUrl?: string): Database {
  if (dbInstance) return dbInstance;
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  pool = postgres(url, { max: 10, prepare: false });
  dbInstance = drizzle(pool, { schema });
  return dbInstance;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end({ timeout: 5 });
    pool = undefined;
    dbInstance = undefined;
  }
}

export { schema };
