import { describe, it, expect, afterEach } from 'vitest'
import { signApproval, verifyApproval } from '../../src/core/approval'
import { strippedAgentEnv, APPROVAL_SECRET_ENV } from '../../src/adapters/approval-secret'

const secret = 'top-secret-32-bytes-of-entropy-xx'
const claim = { scope: 'merge', diff_hash: 'abc123', cycle: 7 }

describe('signed approval (P1-5)', () => {
  it('verifies a signature it produced', () => {
    expect(verifyApproval(secret, signApproval(secret, claim), claim)).toBe(true)
  })

  it('rejects a tampered signature', () => {
    expect(verifyApproval(secret, 'deadbeef'.repeat(8), claim)).toBe(false)
  })

  it('rejects the wrong secret', () => {
    expect(verifyApproval('other-secret', signApproval(secret, claim), claim)).toBe(false)
  })

  it('rejects a replay against a different diff/cycle (claim binding)', () => {
    const sig = signApproval(secret, claim)
    expect(verifyApproval(secret, sig, { ...claim, diff_hash: 'XYZ' })).toBe(false)
    expect(verifyApproval(secret, sig, { ...claim, cycle: 8 })).toBe(false)
  })

  it('rejects empty secret or empty signature', () => {
    expect(verifyApproval('', signApproval(secret, claim), claim)).toBe(false)
    expect(verifyApproval(secret, '', claim)).toBe(false)
  })
})

describe('agent env isolation', () => {
  const prev = process.env[APPROVAL_SECRET_ENV]
  afterEach(() => {
    if (prev === undefined) delete process.env[APPROVAL_SECRET_ENV]
    else process.env[APPROVAL_SECRET_ENV] = prev
  })

  it('strips the approval secret from a spawned agent env', () => {
    process.env[APPROVAL_SECRET_ENV] = secret
    const env = strippedAgentEnv({ FORCE_COLOR: '1' })
    expect(env.FORCE_COLOR).toBe('1')
    expect(env[APPROVAL_SECRET_ENV]).toBeUndefined()
  })
})
