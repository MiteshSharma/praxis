import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Minimal migration runner: scans ../drizzle for *.sql files, tracks applied
 * migrations in a `_migrations` table, and applies new ones in lexicographic
 * order. Idempotent — safe to run on every worker startup.
 */
export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const dir = resolve(__dirname, '..', 'drizzle');
  const files = (await readdir(dir))
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const applied: string[] = [];

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS _migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    for (const file of files) {
      const existing = await sql`SELECT name FROM _migrations WHERE name = ${file}`;
      if (existing.length > 0) continue;

      const contents = await readFile(join(dir, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(contents);
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });
      applied.push(file);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  return applied;
}
