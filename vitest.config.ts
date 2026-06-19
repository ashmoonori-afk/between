import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
    // real-git integration setup can exceed the 10s default on a cold Windows runner (P3-11)
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // serialize test FILES so the real-git integration suites don't contend on Windows (P3-11)
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/core/**'],
      thresholds: {
        // The deterministic core must stay well-tested (project rule: 80%).
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
})
