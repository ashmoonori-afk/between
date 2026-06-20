import { describe, it, expect } from 'vitest'
import {
  sealEntry,
  verifyChain,
  verifyChainHead,
  chainHeadOf,
  GENESIS_HASH,
} from '../../src/core/journal'

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

describe('chain-head pin (B5 tail-truncation)', () => {
  it('chainHeadOf returns the tail hash + entry count, null for an empty chain', () => {
    expect(chainHeadOf([])).toBeNull()
    const c = chain([{ event: 'a' }, { event: 'b' }, { event: 'c' }])
    expect(chainHeadOf(c)).toEqual({ hash: c[2]!.hash, count: 3 })
  })

  it('verifies when the on-disk chain still matches the pin', () => {
    const c = chain([{ event: 'a' }, { event: 'b' }, { event: 'c' }])
    expect(verifyChainHead(c, chainHeadOf(c)).ok).toBe(true)
  })

  it('DETECTS tail-truncation that verifyChain alone cannot', () => {
    const c = chain([{ event: 'a' }, { event: 'b' }, { event: 'c' }])
    const pin = chainHeadOf(c) // pins count=3
    const truncated = [c[0]!] // attacker drops the newest 2 entries -> still a valid chain
    expect(verifyChain(truncated).valid).toBe(true) // verifyChain is fooled
    const r = verifyChainHead(truncated, pin)
    expect(r.ok).toBe(false) // the pin catches it
    expect(r.reason).toMatch(/truncation/)
  })

  it('tolerates a journal that has grown PAST the pin (pin is a valid prefix)', () => {
    const c = chain([{ event: 'a' }, { event: 'b' }])
    const pin = chainHeadOf(c) // count=2
    const grown = chain([{ event: 'a' }, { event: 'b' }, { event: 'c' }, { event: 'd' }])
    expect(verifyChainHead(grown, pin).ok).toBe(true)
  })

  it('detects substitution of the pinned entry at its recorded position', () => {
    const c = chain([{ event: 'a' }, { event: 'b' }, { event: 'c' }])
    const pin = chainHeadOf(c)
    const swapped = chain([{ event: 'a' }, { event: 'b' }, { event: 'EVIL' }])
    expect(verifyChainHead(swapped, pin).ok).toBe(false)
  })

  it('a null/empty pin verifies vacuously (fresh repo, nothing pinned yet)', () => {
    expect(verifyChainHead([], null).ok).toBe(true)
    expect(verifyChainHead(chain([{ event: 'a' }]), null).ok).toBe(true)
    expect(verifyChainHead([], { hash: 'x', count: 0 }).ok).toBe(true)
  })
})
