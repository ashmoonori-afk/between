import { createHash } from 'node:crypto'
import { hashDiff } from '../core/diff-hash'
import type { DiffInput } from '../core/types'

/**
 * A1 (review P0-4): the immutable Review Object. A bundle captures the EXACT content that was
 * hashed (`DiffInput`) plus the repository + environment provenance, and is content-addressed by
 * `bundle_id`. The invariant the whole product rests on: the hash that gets approved
 * (`diff_hash`) == what is stored here == what the reviewer reads. Reviewers must read a bundle
 * (or a read-only worktree built from one), never the live `git diff HEAD`.
 */
export const BUNDLE_SCHEMA_VERSION = 2

const NUL = String.fromCharCode(0)

export interface BundleRepository {
  /** HEAD commit sha, or null when the repo has no commit yet. */
  head_sha: string | null
  /** current branch, or null when detached / unborn. */
  branch: string | null
  /** `git write-tree` OID of the index (repo-state fingerprint); '' when unavailable. */
  index_tree: string
}

export interface BundleEnvironment {
  between_version: string
  git_version: string
  /** sha256 of `.gitattributes` (affects diff normalization), or '' when none. */
  attributes_hash: string
}

export interface ReviewBundleInput {
  diff: DiffInput
  repository: BundleRepository
  environment: BundleEnvironment
}

export interface ReviewBundle extends ReviewBundleInput {
  schema_version: number
  /** content address over (diff_hash + repository + environment). */
  bundle_id: string
  /** sha256 of the diff payload alone — identical to `core/diff-hash.hashDiff(diff)`. */
  diff_hash: string
}

/** Canonical, NUL-separated serialization that `bundle_id` is the sha256 of. */
function canonicalBundlePayload(input: ReviewBundleInput, diffHash: string): string {
  const r = input.repository
  const e = input.environment
  return [
    `BETWEEN_BUNDLE_V${BUNDLE_SCHEMA_VERSION}`,
    'DIFF',
    diffHash,
    'REPO',
    r.head_sha ?? '',
    r.branch ?? '',
    r.index_tree,
    'ENV',
    e.between_version,
    e.git_version,
    e.attributes_hash,
  ].join(NUL)
}

/**
 * Pure: turn captured parts into a content-addressed immutable bundle. `diff_hash` reuses the
 * canonical diff hash so it is byte-identical to the value the daemon binds an approval to.
 */
export function buildBundle(input: ReviewBundleInput): ReviewBundle {
  const diff_hash = hashDiff(input.diff)
  const bundle_id = createHash('sha256')
    .update(canonicalBundlePayload(input, diff_hash), 'utf8')
    .digest('hex')
  return { schema_version: BUNDLE_SCHEMA_VERSION, bundle_id, diff_hash, ...input }
}

/** sha256 of arbitrary text (used for the .gitattributes fingerprint). */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}
