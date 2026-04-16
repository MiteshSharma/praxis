import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@shared/core': new URL('./shared/core/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['shared/**/*.test.ts', 'services/**/*.test.ts'],
  },
});
