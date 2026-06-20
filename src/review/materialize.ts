import { execa } from 'execa'
import type { ReviewBundle } from './bundle'
import type { WorktreeProvider } from '../adapters/worktree'

/** Pin autocrlf so the patch applies byte-for-byte (matches the bundle's deterministic capture). */
const PIN = ['-c', 'core.autocrlf=false']

/** Default name of the isolated, read-only worktree the reviewer reads from. */
export const REVIEWER_WORKTREE = 'reviewer-readonly'

/**
 * B1: materialize a reviewer worktree that reproduces EXACTLY the state the bundle sealed (A1) —
 * check out the base commit, then apply the bundle's tracked patch. The reviewer reads this
 * isolated tree instead of the live (possibly moved-on) working tree. It is read-only by
 * CONVENTION for now (the reviewer must not write); OS-level read-only + network-deny are later
 * B1 slices. Returns the worktree path.
 *
 * Limitations (a later slice): only the TRACKED text patch is materialized — binary changes and
 * untracked files (the bundle carries them as an OID manifest, not content) are not reconstructed
 * in the worktree; the reviewer still has the full picture in the bundle JSON. A binary diff makes
 * `git apply` fail, so this throws (and cleans up) rather than producing a wrong tree.
 */
export async function materializeBundle(
  bundle: ReviewBundle,
  wp: WorktreeProvider,
  name: string = REVIEWER_WORKTREE,
): Promise<string> {
  const base = bundle.repository.head_sha
  if (!base) {
    throw new Error('cannot materialize a bundle with no base commit (unborn HEAD)')
  }
  const path = await wp.create(name, base)
  const patch = bundle.diff.tracked
  if (patch.trim().length > 0) {
    const r = await execa('git', [...PIN, 'apply', '--whitespace=nowarn'], {
      cwd: path,
      input: patch,
      reject: false,
    })
    if (r.exitCode !== 0) {
      await wp.remove(name) // don't leave a half-applied worktree behind
      throw new Error(
        `failed to apply the bundle patch to the reviewer worktree: ${r.stderr.trim()}`,
      )
    }
  }
  return path
}
