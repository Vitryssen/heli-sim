import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/heli-sim/',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
