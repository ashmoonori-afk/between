import { printErr } from './output'

export const VERSION = '0.1.0'

export const ASCII =
  !process.stdout.isTTY || Boolean(process.env.NO_COLOR) || Boolean(process.env.BETWEEN_ASCII)

export function root(): string {
  return process.cwd()
}

export async function fail(err: unknown): Promise<never> {
  printErr(`between: ${err instanceof Error ? err.message : String(err)}`)
  process.exitCode = 1
  throw err
}
