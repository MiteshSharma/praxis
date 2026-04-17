import type { Database } from '@shared/db';
import { S3MemoryBackend } from '@shared/memory';
import { registerMemoryBackend } from './registry.js';

registerMemoryBackend('s3', (config) => {
  const cfg = config as { db: Database };
  if (!cfg.db) return null;
  return new S3MemoryBackend(cfg.db);
});
