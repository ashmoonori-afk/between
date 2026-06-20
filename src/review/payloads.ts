import { stat, readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import type { UntrackedEntry } from '../core/types'
import { containsSecret } from '../core/redact'
import { isDeniedUntrackedPath, normalizeRepoRelativePath } from '../core/untracked-policy'
import type { BundlePayload } from './bundle'

export const DEFAULT_BUNDLE_PAYLOAD_MAX_BYTES = 262144

export class BundlePayloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BundlePayloadError'
  }
}

export async function captureUntrackedPayloads(
  root: string,
  entries: readonly UntrackedEntry[],
  hashObject: (path: string) => Promise<string>,
  maxBytes: number = DEFAULT_BUNDLE_PAYLOAD_MAX_BYTES,
): Promise<BundlePayload[]> {
  const payloads: BundlePayload[] = []
  for (const entry of [...entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const path = normalizeRepoRelativePath(entry.path)
    if (!path || isDeniedUntrackedPath(path)) continue
    const target = resolveRepoPayloadPath(root, path)
    const info = await stat(target).catch(() => null)
    if (!info) throw new BundlePayloadError(`untracked file disappeared during capture: ${path}`)
    if (!info.isFile()) throw new BundlePayloadError(`unsupported untracked file type: ${path}`)
    if (info.size > maxBytes) continue
    const oid = await hashObject(path)
    if (oid !== entry.oid) {
      throw new BundlePayloadError(`untracked file changed during capture: ${path}`)
    }
    const content = await readFile(target)
    if (content.byteLength > maxBytes) continue
    const text = textPayload(content)
    if (text !== null && containsSecret(text)) {
      throw new BundlePayloadError(`untracked payload contains a secret-like value: ${path}`)
    }
    payloads.push({
      path,
      oid: entry.oid,
      size: content.byteLength,
      encoding: 'base64',
      content: content.toString('base64'),
    })
  }
  return payloads
}

function textPayload(content: Buffer): string | null {
  if (content.includes(0)) return null
  const text = content.toString('utf8')
  return text.includes('\uFFFD') ? null : text
}

export function resolveRepoPayloadPath(root: string, path: string): string {
  const safePath = normalizeRepoRelativePath(path)
  if (!safePath || isDeniedUntrackedPath(safePath)) {
    throw new BundlePayloadError(`unsafe payload path: ${path}`)
  }
  const rootAbs = resolve(root)
  const target = resolve(rootAbs, ...safePath.split('/'))
  const rel = relative(rootAbs, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new BundlePayloadError(`payload escapes repository root: ${path}`)
  }
  return target
}
