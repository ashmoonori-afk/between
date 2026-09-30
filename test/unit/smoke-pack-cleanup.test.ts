import { describe, expect, it } from 'vitest'
import { removeWorkDir, withWorkDir } from '../../scripts/smoke-cleanup.mjs'

// A remover that fails like a Windows runner holding a just-exited child's cwd open.
function lockedRemover() {
  let calls = 0
  const remove = async (): Promise<void> => {
    calls++
    throw Object.assign(new Error('EPERM: operation not permitted, rmdir'), { code: 'EPERM' })
  }
  return { remove, calls: () => calls }
}

describe('smoke:pack temp-dir cleanup', () => {
  it('turns a locked temp dir into a warning after a bounded number of retries', async () => {
    const locked = lockedRemover()
    const warnings: string[] = []
    const result = await withWorkDir('/tmp/between-smoke-pack-x', async () => 'smoke ok', {
      remove: locked.remove,
      attempts: 3,
      delayMs: 0,
      warn: (m: string) => warnings.push(m),
    })
    expect(result).toBe('smoke ok')
    expect(locked.calls()).toBe(3)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('EPERM')
  })

  it('still fails the smoke with the real error when the body fails and cleanup is locked', async () => {
    const locked = lockedRemover()
    const warnings: string[] = []
    const packFailure = new Error('npm pack failed')
    await expect(
      withWorkDir(
        '/tmp/between-smoke-pack-x',
        async () => {
          throw packFailure
        },
        { remove: locked.remove, attempts: 2, delayMs: 0, warn: (m: string) => warnings.push(m) },
      ),
    ).rejects.toBe(packFailure)
    expect(locked.calls()).toBe(2)
    expect(warnings).toHaveLength(1)
  })

  it('stops retrying once removal succeeds and warns about nothing', async () => {
    let calls = 0
    const warnings: string[] = []
    const ok = await removeWorkDir('/tmp/between-smoke-pack-x', {
      remove: async () => {
        calls++
        if (calls === 1) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      },
      attempts: 5,
      delayMs: 0,
      warn: (m: string) => warnings.push(m),
    })
    expect(ok).toBe(true)
    expect(calls).toBe(2)
    expect(warnings).toEqual([])
  })
})
