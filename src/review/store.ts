import { mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import type { GitAdapter, DiffInputOptions } from '../adapters/git'
import type { DiffInput } from '../core/types'
import { buildBundle, sha256, type ReviewBundle } from './bundle'

/** Immutable bundles live under .between/bundles/<bundle_id>.json (content-addressed). */
export function bundlesDir(root: string): string {
  return join(resolve(root), '.between', 'bundles')
}
export function bundlePath(root: string, bundleId: string): string {
  return join(bundlesDir(root), `${bundleId}.json`)
}

/**
 * Build an immutable bundle from an ALREADY-captured diff plus live repo/env provenance. Used by
 * the daemon so the bundle binds to the exact `DiffInput` whose hash opened the cycle (no re-read,
 * no chance of drift between the approved hash and the stored content).
 */
export async function bundleFromDiff(
  git: GitAdapter,
  diff: DiffInput,
  betweenVersion: string,
): Promise<ReviewBundle> {
  const [head_sha, branch, index_tree, git_version, attributesText] = await Promise.all([
    git.headSha(),
    git.branch(),
    git.indexTree(),
    git.gitVersion(),
    git.attributesText(),
  ])
  return buildBundle({
    diff,
    repository: { head_sha, branch, index_tree },
    environment: {
      between_version: betweenVersion,
      git_version,
      attributes_hash: attributesText ? sha256(attributesText) : '',
    },
  })
}

/** Assemble an immutable bundle by capturing the live diff first (convenience for CLI/tests). */
export async function captureBundle(
  git: GitAdapter,
  opts: DiffInputOptions,
  betweenVersion: string,
): Promise<ReviewBundle> {
  return bundleFromDiff(git, await git.diffInput(opts), betweenVersion)
}

/** Persist a bundle atomically; returns its path. Bundles are immutable — same id, same content. */
export async function writeBundle(root: string, bundle: ReviewBundle): Promise<string> {
  await mkdir(bundlesDir(root), { recursive: true })
  const path = bundlePath(root, bundle.bundle_id)
  await writeFileAtomic(path, `${JSON.stringify(bundle, null, 2)}\n`)
  return path
}

export async function readBundle(root: string, bundleId: string): Promise<ReviewBundle | null> {
  const path = bundlePath(root, bundleId)
  if (!existsSync(path)) return null
  return JSON.parse(await readFile(path, 'utf8')) as ReviewBundle
}
