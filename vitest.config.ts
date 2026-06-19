import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'node',
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
