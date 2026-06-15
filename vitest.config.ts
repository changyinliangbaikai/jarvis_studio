import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/server/src/**/*.test.ts'],
    environment: 'node'
  }
});
