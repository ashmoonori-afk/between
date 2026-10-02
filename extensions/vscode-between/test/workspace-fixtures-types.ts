// Type declaration only (never imported at runtime): gives `workspace-fixtures` a typed module
// surface for `tsc` even though the implementation stays JS, matching the extension's JS+checkJs
// setup. Keep in sync with workspace-fixtures.ts.
export interface SeedWorkspaceOptions {
  evidenceTrust?: 'real' | 'simulated'
  writeBundle?: boolean
  /** provision `.git/between-approval.key`; opt-in only (the env secret is the real contract). */
  legacyApprovalKey?: string
}

export function seedWorkspace(options?: SeedWorkspaceOptions): Promise<string>
export function readCommands(root: string): Promise<Array<Record<string, unknown>>>
