import { open, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { BetweenEvent } from '../core/types'
import { EVENT_SCHEMA_VERSION } from '../core/types'
import { betweenPaths } from './paths'
import { defaultJournalAnchor, JournalRollbackError, type JournalAnchor } from './journal-anchor'
import {
  sealEntry,
  verifyChain,
  verifyChainHead,
  GENESIS_HASH,
  type ChainHead,
  type ChainVerification,
  type HeadVerification,
  type JournalPayload,
} from '../core/journal'

/**
 * Append-only event log (I2, I23). Writes go through a single in-process promise queue
 * so concurrent appends can never interleave a partial line. Each line is a complete
 * `\n`-terminated JSON object, fsync'd. The reader repairs (skips) a trailing partial
 * line rather than treating it as fatal.
 *
 * B5: each line is also hash-chained (`seq` + `prev_hash` + `hash`) so editing/reordering/
 * truncating the journal is detectable via `verify()`. The extra fields are additive — existing
 * readers (status, summarize, dashboard) ignore them.
 */
export class EventsLog {
  private readonly path: string
  private queue: Promise<void> = Promise.resolve()
  private lastHash: string | undefined // undefined until initialized from disk
  private lastSeq = -1
  private readonly anchor: JournalAnchor | null
  private anchoredCount = 0
  private anchorWarned = false

  /** `anchor` defaults to the per-user store chosen by `BETWEEN_JOURNAL_ANCHOR`; null disables it. */
  constructor(root: string, opts: { anchor?: JournalAnchor | null } = {}) {
    this.path = betweenPaths(root).events
    this.anchor = opts.anchor === undefined ? defaultJournalAnchor(root) : opts.anchor
  }

  append(event: Omit<BetweenEvent, 'v'>): Promise<void> {
    // Serialize onto the queue so the chain head (lastHash/lastSeq) advances atomically per write.
    const write = this.queue.then(async () => {
      if (this.lastHash === undefined) await this.initChain()
      const seq = this.lastSeq + 1
      const payload = { v: EVENT_SCHEMA_VERSION, ...event, seq } as unknown as JournalPayload
      const sealed = sealEntry(payload, this.lastHash!)
      // Advance the in-memory chain head ONLY after the line is durably written (finding #2):
      // if writeLine throws, lastHash/lastSeq stay put, so the NEXT append re-links off the last
      // entry that actually hit disk instead of a phantom one (which broke the chain at brokenAt:0).
      await this.writeLine(JSON.stringify(sealed) + '\n')
      this.lastHash = sealed.hash
      this.lastSeq = seq
      await this.advanceAnchor()
    })
    // queue advances with a swallowed copy so one failed write doesn't poison future appends
    this.queue = write.catch(() => {})
    return write
  }

  /**
   * Fix the write cursor to the journal as it is NOW (the daemon calls this at load). Without it
   * the cursor is seeded lazily at the first append, so entries someone appended in between would
   * be silently adopted into the chain the daemon then pins.
   */
  prime(): Promise<void> {
    const init = this.queue.then(async () => {
      if (this.lastHash === undefined) await this.initChain()
    })
    this.queue = init.catch(() => {})
    return init
  }

  /** Seed the chain head from the last persisted entry (once, inside the write queue). */
  private async initChain(): Promise<void> {
    const entries = await this.read()
    await this.assertAnchored(entries)
    const last = entries.at(-1) as { hash?: string; seq?: number } | undefined
    this.lastHash = typeof last?.hash === 'string' ? last.hash : GENESIS_HASH
    this.lastSeq = typeof last?.seq === 'number' ? last.seq : entries.length - 1
  }

  /**
   * The current chain head to pin in state.json (B5), from the in-memory cursor advanced by
   * `append`. null before anything is appended this process. count = seq + 1 (seq is 0-based).
   * The head is only returned when lastHash is a real 64-hex sha256 (review): a malformed/empty
   * tail hash (already a broken chain that verifyChain catches) must not be pinned as a valid head.
   */
  head(): ChainHead | null {
    if (this.lastSeq < 0 || !/^[a-f0-9]{64}$/.test(this.lastHash ?? '')) return null
    return { hash: this.lastHash!, count: this.lastSeq + 1 }
  }

  /** Walk the hash chain; reports the first tampered/broken entry, or valid (B5). */
  async verify(): Promise<ChainVerification> {
    return verifyChain((await this.read()) as unknown as JournalPayload[])
  }

  /**
   * Combined integrity check (single read): the hash chain AND the pinned head from state.json.
   * `valid` is true only when both hold — so tail-truncation (caught only by the pin) fails too.
   */
  async verifyAll(pin: ChainHead | null): Promise<{
    chain: ChainVerification
    head: HeadVerification
    anchor: HeadVerification
    valid: boolean
  }> {
    const entries = (await this.read()) as unknown as JournalPayload[]
    const chain = verifyChain(entries)
    const head = verifyChainHead(entries, pin)
    let anchor: HeadVerification = { ok: true }
    try {
      await this.assertAnchored(entries)
    } catch (e) {
      if (!(e instanceof JournalRollbackError)) throw e
      anchor = { ok: false, reason: e.message }
    }
    return { chain, head, anchor, valid: chain.valid && head.ok && anchor.ok }
  }

  /**
   * Fail closed when the on-disk journal no longer contains the entry recorded in the anchor
   * outside `.between/` (rollback or deletion of events.jsonl + state.json together). An anchor
   * store that cannot be read (locked keychain, unreadable dir) is reported once and skipped, so a
   * missing OS facility degrades detection instead of stopping the broker.
   */
  async assertAnchored(entries?: ReadonlyArray<BetweenEvent | JournalPayload>): Promise<void> {
    if (!this.anchor) return
    let anchored: ChainHead | null
    try {
      anchored = await this.anchor.read()
    } catch (e) {
      this.warnAnchor(e)
      return
    }
    if (!anchored) return
    const onDisk = (entries ?? (await this.read())) as unknown as JournalPayload[]
    if (!verifyChainHead(onDisk, anchored).ok) {
      throw new JournalRollbackError(
        `journal rolled back: events.jsonl has ${onDisk.length} entries and does not contain entry ` +
          `#${anchored.count} (${anchored.hash.slice(0, 12)}) anchored in ${this.anchor.describe()}. ` +
          'If you restored .between/ on purpose, run `between journal --reset-anchor`.',
      )
    }
    this.anchoredCount = Math.max(this.anchoredCount, anchored.count)
  }

  /**
   * Re-anchor to the journal as it is now (human recovery after an intentional restore). The chain
   * itself must be intact; an empty journal clears the anchor. Returns the anchored head.
   */
  async resetAnchor(): Promise<ChainHead | null> {
    if (!this.anchor) return null
    const entries = (await this.read()) as unknown as JournalPayload[]
    const chain = verifyChain(entries)
    if (!chain.valid) {
      throw new JournalRollbackError(
        `journal chain is broken (${chain.reason ?? 'invalid'}); refusing to anchor it`,
      )
    }
    const last = entries.at(-1) as { hash?: string } | undefined
    if (!last?.hash) {
      await this.anchor.clear()
      this.anchoredCount = 0
      return null
    }
    const head = { hash: last.hash, count: entries.length }
    await this.anchor.write(head)
    this.anchoredCount = head.count
    return head
  }

  get anchorKind(): JournalAnchor['kind'] | null {
    return this.anchor?.kind ?? null
  }

  /** Move the anchor forward to the in-memory head; never backwards, never fatal. */
  private async advanceAnchor(): Promise<void> {
    const head = this.head()
    if (!this.anchor || !head || head.count <= this.anchoredCount) return
    try {
      await this.anchor.write(head)
      this.anchoredCount = head.count
    } catch (e) {
      this.warnAnchor(e)
    }
  }

  private warnAnchor(e: unknown): void {
    if (this.anchorWarned) return
    this.anchorWarned = true
    const msg = e instanceof Error ? e.message : String(e)
    process.emitWarning(`between: journal anchor unavailable (${msg}); rollback detection is off`)
  }

  /** protected so tests can inject a write failure to exercise the append fail-safe (finding #2). */
  protected async writeLine(line: string): Promise<void> {
    const fh = await open(this.path, 'a')
    try {
      await fh.write(line)
      await fh.sync()
    } finally {
      await fh.close()
    }
  }

  /** Read all well-formed events, repairing a trailing partial/garbage line. */
  async read(): Promise<BetweenEvent[]> {
    if (!existsSync(this.path)) return []
    const raw = await readFile(this.path, 'utf8')
    const out: BetweenEvent[] = []
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      try {
        out.push(JSON.parse(line) as BetweenEvent)
      } catch {
        // partial/corrupt line (e.g. crash mid-write) — skip, don't fail
      }
    }
    return out
  }
}
