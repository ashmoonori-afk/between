export class BetweenWorkspaceError extends Error {
  constructor(message) {
    super(message)
    this.name = 'BetweenWorkspaceError'
  }
}
