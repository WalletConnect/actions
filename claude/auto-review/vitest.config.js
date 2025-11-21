import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['scripts/**/*.js'],
      exclude: ['scripts/__tests__/**', 'scripts/**/*.test.js'],
    },
    include: ['scripts/__tests__/**/*.test.js'],
  },
});
