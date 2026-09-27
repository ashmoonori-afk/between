import { verifyPush } from '../api/checks'
import { print, printErr } from './output'

export async function runVerifyPushCommand(root: string): Promise<void> {
  const verdict = await verifyPush(root)
  if (verdict.message === null) return
  if (verdict.allowed) {
    print(`between: ${verdict.message}`)
    return
  }
  printErr(`between: ${verdict.message}`)
  process.exitCode = 1
}
