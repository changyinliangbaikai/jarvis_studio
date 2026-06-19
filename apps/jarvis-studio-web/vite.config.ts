import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@jarvis/shared-types': resolve(import.meta.dirname, '../../packages/shared-types/src/index.ts'),
      '@jarvis/trace-sdk': resolve(import.meta.dirname, '../../packages/trace-sdk/src/index.ts')
    }
  },
  server: {
    port: 4311,
    proxy: { '/api': 'http://127.0.0.1:4310' }
  },
  build: { outDir: resolve(import.meta.dirname, 'dist'), emptyOutDir: true }
});
