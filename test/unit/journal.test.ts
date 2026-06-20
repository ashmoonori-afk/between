import { describe, it, expect } from 'vitest'
import { sealEntry, verifyChain, GENESIS_HASH } from '../../src/core/journal'

/** Build a valid chain of n payloads. */
function chain(payloads: Array<Record<string, unknown>>) {
  const out = []
  let prev = GENESIS_HASH
  for (const p of payloads) {
    const e = sealEntry(p, prev)
    out.push(e)
    prev = e.hash
  }
  return out
}

describe('hash-chained journal (B5)', () => {
  it('seals deterministically and verifies a valid chain', () => {
    const c = chain([{ event: 'a' }, { event: 'b' }, { event: 'c' }])
    expect(c[0]!.prev_hash).toBe(GENESIS_HASH)
    expect(c[1]!.prev_hash).toBe(c[0]!.hash)
    expect(verifyChain(c)).toEqual({ valid: true, brokenAt: null })
    // sealing the same payload + prev is deterministic
    expect(sealEntry({ event: 'a' }, GENESIS_HASH).hash).toBe(c[0]!.hash)
  })

  it('detects a tampered payload (hash mismatch)', () => {
    const c = chain([{ event: 'a' }, { event: 'b' }])
    const tampered = [...c]
    tampered[0] = { ...c[0]!, event: 'EVIL' } // edit content, keep the old hash
    const r = verifyChain(tampered)
    expect(r.valid).toBe(false)
    expect(r.brokenAt).toBe(0)
    expect(r.reason).toMatch(/tampered/)
  })

  it('detects truncation / reordering (broken link)', () => {
    const c = chain([{ event: 'a' }, { event: 'b' }, { event: 'c' }])
    expect(verifyChain([c[0]!, c[2]!]).valid).toBe(false) // dropped the middle entry
    expect(verifyChain([c[1]!, c[0]!, c[2]!]).valid).toBe(false) // reordered
  })

  it('flags an unchained (legacy) entry', () => {
    expect(verifyChain([{ event: 'legacy-no-hash' }]).valid).toBe(false)
  })
})
