import type { Clock } from './types'

/** Real wall-clock. The ONLY place core touches real time; everything else takes a Clock. */
export class SystemClock implements Clock {
  now(): number {
    return Date.now()
  }

  nowIso(): string {
    return new Date().toISOString()
  }
}

/**
 * Deterministic clock for tests. Advance time explicitly so debounce/timeout
 * logic is reproducible (pairs with @sinonjs/fake-timers for timer-driven code).
 */
export class FakeClock implements Clock {
  private ms: number

  constructor(startMs = 0) {
    this.ms = startMs
  }

  now(): number {
    return this.ms
  }

  nowIso(): string {
    return new Date(this.ms).toISOString()
  }

  /** advance by `deltaMs` and return the new time */
  advance(deltaMs: number): number {
    this.ms += deltaMs
    return this.ms
  }

  set(ms: number): void {
    this.ms = ms
  }
}
