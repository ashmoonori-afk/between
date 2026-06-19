import { InvalidArgumentError } from 'commander'

/** Floor for the dashboard refresh interval — guards against a 0/NaN tight poll loop. */
export const MIN_DASH_INTERVAL_MS = 250

/**
 * Validate `--interval <ms>` at the CLI boundary as an integer >= MIN_DASH_INTERVAL_MS.
 * `Number('0')`/`Number('abc')` would otherwise collapse `setInterval` to a 1ms loop
 * that hammers `.between/state.json` and `events.jsonl`.
 */
export function parseInterval(value: string): number {
  const n = Number(value)
  if (!Number.isInteger(n) || n < MIN_DASH_INTERVAL_MS) {
    throw new InvalidArgumentError(`interval must be an integer >= ${MIN_DASH_INTERVAL_MS} (ms)`)
  }
  return n
}
