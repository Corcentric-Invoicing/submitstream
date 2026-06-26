import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      // Dev convenience: proxy /api/* to the production worker so we don't
      // have to run a local Cloudflare Worker with all its R2 / Supabase /
      // Corcentric bindings. Heads-up: this means dev hits PRODUCTION data
      // — every mutation (PATCH, POST submit, etc.) is real.
      // For local-only development, replace target with 'http://localhost:8787'
      // and run `npm run dev:workers` from the repo root.
      '/api': {
        target: 'https://submitstream.com',
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
