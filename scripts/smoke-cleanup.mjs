// Temp-dir cleanup for the pack smoke. Removing the work dir is housekeeping, not a smoke
// assertion: on Windows runners a just-exited child can hold its cwd (or an npm cache file)
// open for a while, so removal can fail with EPERM/EBUSY even after rm's own retries. A failed
// cleanup is retried a bounded number of times and then reported as a warning; it never fails the
// smoke and never masks the error of a smoke step that really failed.
import { rm } from 'node:fs/promises'

const defaultRemove = (dir) =>
  rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })

const defaultWarn = (message) => process.stderr.write(`${message}\n`)

/** Remove `dir`, retrying up to `attempts` times. Resolves false (after one warning) on failure. */
export async function removeWorkDir(
  dir,
  { remove = defaultRemove, attempts = 3, delayMs = 1000, warn = defaultWarn } = {},
) {
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await remove(dir)
      return true
    } catch (error) {
      last = error
      if (attempt < attempts) await new Promise((r) => setTimeout(r, delayMs * attempt))
    }
  }
  const reason = last instanceof Error ? last.message : String(last)
  warn(
    `warning: could not remove smoke temp dir ${dir} after ${attempts} attempts (${reason}); ` +
      'leaving it for the OS temp cleaner',
  )
  return false
}

/** Run `body`, then clean up `dir`. The body's result or error is what the caller sees. */
export async function withWorkDir(dir, body, options) {
  try {
    return await body()
  } finally {
    await removeWorkDir(dir, options)
  }
}
