import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@conveyor/dashboard-client': resolve(
        import.meta.dirname!,
        '../../dashboard-client/src/mod.ts',
      ),
      '@conveyor/shared': resolve(
        import.meta.dirname!,
        '../../shared/src/mod.ts',
      ),
    },
  },
  server: {
    port: 5188,
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
});
