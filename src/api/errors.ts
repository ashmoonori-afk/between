export type BetweenApiErrorCode = 'no_state' | 'invalid_argument' | 'not_found'

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
