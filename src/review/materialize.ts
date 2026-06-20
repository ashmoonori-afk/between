import { execa } from 'execa'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { verifyBundleIntegrity, type ReviewBundle } from './bundle'
import { resolveRepoPayloadPath } from './payloads'
import type { WorktreeProvider } from '../adapters/worktree'
import { sealSandboxedWorktree, type SandboxRole } from '../adapters/sandbox'

const PIN = ['-c', 'core.autocrlf=false']

export const REVIEWER_WORKTREE = 'reviewer-readonly'

export async function materializeBundle(
  bundle: ReviewBundle,
  wp: WorktreeProvider,
  name: string = REVIEWER_WORKTREE,
): Promise<string> {
  const integrity = verifyBundleIntegrity(bundle)
  if (!integrity.ok) {
    throw new Error(`cannot materialize a tampered bundle: ${integrity.reason ?? 'unknown'}`)
  }
  const base = bundle.repository.head_sha
  if (!base) {
    throw new Error('cannot materialize a bundle with no base commit (unborn HEAD)')
  }
  const path = await wp.create(name, base)
  try {
    await applyTrackedPatch(path, bundle.diff.tracked)
    await materializePayloads(bundle, path)
    const role = sandboxRole(name)
    if (role) await sealSandboxedWorktree(wp.rootDir(), role, path)
    return path
  } catch (e) {
    await wp.remove(name)
    if (e instanceof Error) throw e
    throw new Error(String(e))
  }
}

function sandboxRole(name: string): SandboxRole | null {
  if (name === REVIEWER_WORKTREE || name === 'reviewer') return 'reviewer'
  if (name === 'verifier') return 'verifier'
  return null
}

async function applyTrackedPatch(path: string, patch: string): Promise<void> {
  if (patch.trim().length === 0) return
  const r = await execa('git', [...PIN, 'apply', '--whitespace=nowarn'], {
    cwd: path,
    input: patch,
    reject: false,
  })
  if (r.exitCode !== 0) {
    throw new Error(`failed to apply the bundle patch to the reviewer worktree: ${r.stderr.trim()}`)
  }
}

async function materializePayloads(bundle: ReviewBundle, root: string): Promise<void> {
  const manifest = new Set(bundle.diff.untracked.map((entry) => `${entry.path}\0${entry.oid}`))
  for (const payload of bundle.payloads) {
    if (!manifest.has(`${payload.path}\0${payload.oid}`)) {
      throw new Error(`payload ${payload.path} is not present in the sealed untracked manifest`)
    }
    const content = Buffer.from(payload.content, 'base64')
    if (content.byteLength !== payload.size) {
      throw new Error(`payload ${payload.path} size does not match its sealed metadata`)
    }
    const target = resolveRepoPayloadPath(root, payload.path)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
}
