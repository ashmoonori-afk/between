import { buildProgram } from './cli/program'
import { printErr } from './cli/output'

const program = buildProgram()

program.parseAsync(process.argv).catch((e: unknown) => {
  if (!process.exitCode && e instanceof Error) printErr(`between: ${e.message}`)
  if (!process.exitCode) process.exitCode = 1
})
