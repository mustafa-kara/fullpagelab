import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crx } from '@crxjs/vite-plugin';
import { defineConfig } from 'vite';
import manifest from './manifest.config';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [crx({ manifest })],
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src'),
    },
  },
  build: {
    outDir: resolve(rootDir, 'dist', process.env.BUILD_VARIANT === 'cdp' ? 'cdp' : 'store'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        contentAgent: resolve(rootDir, 'src/content/page-agent.ts'),
        offscreen: resolve(rootDir, 'src/offscreen/offscreen.html'),
        sidepanel: resolve(rootDir, 'src/pages/sidepanel/index.html'),
        result: resolve(rootDir, 'src/pages/result/index.html'),
        history: resolve(rootDir, 'src/pages/history/index.html'),
        options: resolve(rootDir, 'src/pages/options/index.html'),
        onboarding: resolve(rootDir, 'src/pages/onboarding/index.html'),
        batch: resolve(rootDir, 'src/pages/batch/index.html'),
        compare: resolve(rootDir, 'src/pages/compare/index.html'),
        print: resolve(rootDir, 'src/pages/print/index.html'),
        popup: resolve(rootDir, 'src/pages/popup/index.html'),
      },
      output: {
        entryFileNames: (chunk) => chunk.name === 'contentAgent' ? 'content/page-agent.js' : 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
