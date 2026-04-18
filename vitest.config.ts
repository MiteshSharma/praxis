import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const sharedPackages = [
  'agent-runtime',
  'contracts',
  'core',
  'db',
  'mcp',
  'memory',
  'sandbox',
  'skills',
  'storage',
  'stream',
  'telemetry',
  'workflows',
];

const alias = Object.fromEntries(
  sharedPackages.map((pkg) => [`@shared/${pkg}`, resolve(`./shared/${pkg}/src`)]),
);

export default defineConfig({
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'services/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'services/web/**'],
  },
  resolve: { alias },
});
