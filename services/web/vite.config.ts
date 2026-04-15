import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const sharedRoot = path.resolve(__dirname, '../../shared');

export default defineConfig({
  plugins: [react()],
  root: __dirname,
  resolve: {
    alias: [
      {
        find: /^@shared\/([^/]+)$/,
        replacement: `${sharedRoot}/$1/src/index.ts`,
      },
      {
        find: /^@shared\/([^/]+)\/(.*)$/,
        replacement: `${sharedRoot}/$1/src/$2`,
      },
    ],
  },
  server: {
    port: 5173,
  },
});
