import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const rootDir = dirname(fileURLToPath(import.meta.url));
const variant = process.env.BUILD_VARIANT === 'cdp' ? 'cdp' : 'store';

await build({
  configFile: false,
  root: rootDir,
  resolve: {
    alias: { '@': resolve(rootDir, 'src') },
  },
  build: {
    outDir: resolve(rootDir, '..', 'dist', variant),
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      input: resolve(rootDir, '..', 'src/content/page-agent.ts'),
      output: {
        format: 'iife',
        name: 'FullPageLabPageAgent',
        inlineDynamicImports: true,
        entryFileNames: 'content/page-agent.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});

console.log(`Standalone content agent built for ${variant}.`);
