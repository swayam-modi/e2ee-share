import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@e2ee-share/protocol': path.resolve(rootDir, 'packages/protocol/src/index.ts'),
      '@e2ee-share/core': path.resolve(rootDir, 'packages/core/src/index.ts'),
      '@e2ee-share/server': path.resolve(rootDir, 'apps/server/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
});
