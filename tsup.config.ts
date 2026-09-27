import { defineConfig } from 'tsup'

export default defineConfig({
  // `index` is the shared core library entry; `cli` is the thin commander front end.
  // `human` holds human-only operations (approve) that agent-facing front ends must not import.
  entry: { cli: 'src/cli.ts', mcp: 'src/mcp.ts', index: 'src/index.ts', human: 'src/human.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // tsup's dts worker injects `baseUrl`, which TypeScript 6 flags as deprecated.
  dts: { entry: { index: 'src/index.ts', human: 'src/human.ts' }, compilerOptions: { ignoreDeprecations: '6.0' } },
  // optional native pty backends are resolved at runtime from node_modules; keep external.
  external: ['node-pty', '@lydell/node-pty'],
  banner: { js: '#!/usr/bin/env node' },
  esbuildOptions(options) {
    options.jsx = 'automatic'
    options.jsxImportSource = 'react'
  },
})
