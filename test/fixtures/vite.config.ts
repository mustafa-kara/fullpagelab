import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const fixtureRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(fixtureRoot, 'pages'),
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
