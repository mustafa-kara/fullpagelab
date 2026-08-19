import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/integration/**/*.int.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**', 'src/shared/**'],
      exclude: [
        'src/shared/types/batch.ts',
        'src/shared/types/capture.ts',
        'src/shared/types/diff.ts',
        'src/shared/types/editor.ts',
        'src/shared/types/export.ts',
        'src/shared/types/history.ts',
        'src/shared/types/messages.ts',
        'src/shared/types/primitives.ts',
        'src/shared/types/presets.ts',
      ],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
