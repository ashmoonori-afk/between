import { NotInitializedError } from '../runtime'
import { ReplayError } from '../core/replay'
import { BundleIntegrityError } from '../review/store'

export type BetweenApiErrorCode =
  | 'no_state'
  | 'invalid_argument'
  | 'not_found'
  | 'invalid_config'
  | 'integrity_error'
  | 'reviewer_failed'
  | 'internal'

/**
 * Typed failure raised by the core API. Front ends map it to their own surface (CLI prints
 * `between: <message>` and exits 1; MCP returns an `isError` tool result). The message is the
 * user-facing text, so both front ends show the same wording.
 */
export class BetweenApiError extends Error {
  readonly code: BetweenApiErrorCode

  constructor(code: BetweenApiErrorCode, message: string) {
    super(message)
    this.name = 'BetweenApiError'
    this.code = code
  }
}

export function noStateError(): BetweenApiError {
  return new BetweenApiError('no_state', 'no state found - run `between init`')
}

const INTERNAL_MESSAGE = 'internal error (see the server log for details)'

/**
 * Normalize any thrown value into a BetweenApiError for agent-facing front ends. Known failures
 * keep their message; anything else becomes a generic `internal` error so subprocess output or
 * other internals never leak to the caller.
 */
export function toApiError(err: unknown): BetweenApiError {
  if (err instanceof BetweenApiError) return err
  if (err instanceof NotInitializedError) return new BetweenApiError('no_state', err.message)
  if (err instanceof ReplayError || err instanceof BundleIntegrityError) {
    return new BetweenApiError('integrity_error', err.message)
  }
  if (err instanceof Error && err.message.startsWith('Invalid config.yaml')) {
    return new BetweenApiError('invalid_config', err.message)
  }
  return new BetweenApiError('internal', INTERNAL_MESSAGE)
}
