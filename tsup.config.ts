import { defineConfig } from 'tsup'

export default defineConfig({
  // `index` is the shared core library entry; `cli` is the thin commander front end.
  entry: { cli: 'src/cli.ts', index: 'src/index.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // tsup's dts worker injects `baseUrl`, which TypeScript 6 flags as deprecated.
  dts: { entry: { index: 'src/index.ts' }, compilerOptions: { ignoreDeprecations: '6.0' } },
  // optional native pty backends are resolved at runtime from node_modules; keep external.
  external: ['node-pty', '@lydell/node-pty'],
  banner: { js: '#!/usr/bin/env node' },
  esbuildOptions(options) {
    options.jsx = 'automatic'
    options.jsxImportSource = 'react'
  },
})
