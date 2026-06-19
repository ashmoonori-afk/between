import { readFile } from 'node:fs/promises'
import { parseReviewRecord, parseVerifyRecord } from '../core/findings'
import { betweenPaths, reviewPath, verifyPath } from '../adapters/paths'
import type { DaemonContext } from './context'

export async function readReview(ctx: DaemonContext) {
  return readJson(
    reviewPath(betweenPaths(ctx.deps.root), ctx.current().workflow.cycle),
    parseReviewRecord,
  )
}

export async function readVerify(ctx: DaemonContext) {
  return readJson(
    verifyPath(betweenPaths(ctx.deps.root), ctx.current().workflow.cycle),
    parseVerifyRecord,
  )
}

async function readJson<T>(path: string, parse: (raw: unknown) => T): Promise<T | null> {
  try {
    return parse(JSON.parse(await readFile(path, 'utf8')))
  } catch {
    return null
  }
}
