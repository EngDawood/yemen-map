import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// The Cloudflare plugin runs worker/index.js (the Ghurba API) next to the site, locally in
// workerd with a local D1 database, and builds both for `wrangler deploy`.
export default defineConfig({
  plugins: [cloudflare()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  environments: {
    client: { build: { rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } } },
  },
});
