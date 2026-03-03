import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
    environmentMatchGlobs: [
      ['src/components/**/*.test.tsx', 'jsdom'],
      ['src/app/**/page.test.tsx', 'jsdom'],
    ],
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/types.ts', 'src/**/*.test.*'],
      thresholds: {
        statements: 50,
        branches: 35,
        functions: 70,
        lines: 50,
      },
    },
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 10_000,
  },
});
