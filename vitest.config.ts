import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'apps/jarvis-cli/src/**/*.test.ts', 'apps/jarvis-studio-server/src/**/*.test.ts', 'apps/jarvis-studio-web/src/**/*.test.{ts,tsx}'],
    environment: 'node'
  },
  resolve: {
    alias: {
      '@jarvis/shared-types': resolve(import.meta.dirname, 'packages/shared-types/src/index.ts'),
      '@jarvis/trace-sdk': resolve(import.meta.dirname, 'packages/trace-sdk/src/index.ts'),
      '@jarvis/permission-engine': resolve(import.meta.dirname, 'packages/permission-engine/src/index.ts'),
      '@jarvis/context-builder': resolve(import.meta.dirname, 'packages/context-builder/src/index.ts'),
      '@jarvis/model-gateway': resolve(import.meta.dirname, 'packages/model-gateway/src/index.ts'),
      '@jarvis/tool-registry': resolve(import.meta.dirname, 'packages/tool-registry/src/index.ts'),
      '@jarvis/skill-loader': resolve(import.meta.dirname, 'packages/skill-loader/src/index.ts'),
      '@jarvis/agent-runtime': resolve(import.meta.dirname, 'packages/agent-runtime/src/index.ts'),
      '@jarvis/artifact-manager': resolve(import.meta.dirname, 'packages/artifact-manager/src/index.ts'),
      '@jarvis/runtime-adapter': resolve(import.meta.dirname, 'packages/runtime-adapter/src/index.ts'),
      '@jarvis/runtime-adapter/local': resolve(import.meta.dirname, 'packages/runtime-adapter/src/local.ts'),
      '@jarvis/runtime-adapter/cli': resolve(import.meta.dirname, 'packages/runtime-adapter/src/cli.ts'),
      '@jarvis/eval-runner': resolve(import.meta.dirname, 'packages/eval-runner/src/index.ts'),
      '@jarvis/prompt-manager': resolve(import.meta.dirname, 'packages/prompt-manager/src/index.ts')
    }
  }
});
