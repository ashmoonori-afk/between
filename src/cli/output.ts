/** Thin stdout/stderr writers so library code never reaches for console.log. */
export function print(message = ''): void {
  process.stdout.write(`${message}\n`)
}

export function printErr(message: string): void {
  process.stderr.write(`${message}\n`)
}

export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}
