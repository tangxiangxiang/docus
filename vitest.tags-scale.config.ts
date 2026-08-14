import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['server/__tests__/**/*.scale.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
    environment: 'node',
    pool: 'forks',
    fileParallelism: false,
    maxWorkers: 1,
    isolate: false,
  },
})
