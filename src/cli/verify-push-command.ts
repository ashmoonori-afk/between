import { text } from 'node:stream/consumers'
import { parsePrePushInput, verifyPush } from '../api/checks'
import { print, printErr } from './output'

export interface VerifyPushOptions {
  stdin?: boolean
}

export async function runVerifyPushCommand(
  root: string,
  opts: VerifyPushOptions = {},
): Promise<void> {
  const updates = opts.stdin ? parsePrePushInput(await text(process.stdin)) : undefined
  const verdict = await verifyPush(root, updates)
  if (verdict.message === null) return
  if (verdict.allowed) {
    print(`between: ${verdict.message}`)
    return
  }
  printErr(`between: ${verdict.message}`)
  process.exitCode = 1
}
