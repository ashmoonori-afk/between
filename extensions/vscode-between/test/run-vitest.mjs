import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const vitest = resolve(here, '..', '..', '..', 'node_modules', 'vitest', 'vitest.mjs')
const input = process.argv.slice(2)
const output = []

for (let i = 0; i < input.length; i += 1) {
  const arg = input[i]
  if (arg === '--grep') {
    const pattern = input[i + 1]
    if (pattern) {
      output.push('-t', pattern)
      i += 1
    }
    continue
  }
  if (arg === '--label') {
    i += 1
    continue
  }
  output.push(arg)
}

const hasRun = output.includes('run') || output.includes('--run')
const args = hasRun ? output : ['run', ...output]
const child = spawn(process.execPath, [vitest, ...args], { stdio: 'inherit' })

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
