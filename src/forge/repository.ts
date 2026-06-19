import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import {
  initialForgeState,
  parseForgeState,
  type ForgeState,
  type InitialForgeOptions,
} from './state'

/** Forge keeps project truth under docs/pwsforge/ (per the PWSForge skill), resume-safe + portable. */
export function forgeDir(root: string): string {
  return join(resolve(root), 'docs', 'pwsforge')
}
export function forgeStatePath(root: string): string {
  return join(forgeDir(root), 'state.json')
}

export async function readForgeState(root: string): Promise<ForgeState | null> {
  const p = forgeStatePath(root)
  if (!existsSync(p)) return null
  return parseForgeState(JSON.parse(await readFile(p, 'utf8')))
}

export async function writeForgeState(root: string, state: ForgeState): Promise<void> {
  await mkdir(forgeDir(root), { recursive: true })
  await writeFileAtomic(forgeStatePath(root), `${JSON.stringify(state, null, 2)}\n`)
}

const INTAKE_STUB = (name: string, idea?: string) => `# ${name} — Forge Intake (Phase 0)

> Project truth for the PWSForge lifecycle. Drive it with \`between forge\`.

## Idea
${idea ?? '_TODO: one-sentence app concept._'}

## Operating constraints
- Platforms: _TODO (iOS / Android / Web)_
- Output depth: _TODO (PRD only / prototype / real code / build / store upload)_
- Technical comfort: non-developer (default)

## Open questions
- _TODO_

## Assumptions
- _TODO_
`

/**
 * Create docs/pwsforge/ with a state.json parked at intake and a 00-intake.md stub (idempotent —
 * never overwrites an existing state.json). Returns the created state.
 */
export async function scaffoldForge(
  root: string,
  opts: InitialForgeOptions = {},
): Promise<{ state: ForgeState; created: string[]; alreadyExisted: boolean }> {
  const dir = forgeDir(root)
  const created: string[] = []
  await mkdir(dir, { recursive: true })

  const existing = await readForgeState(root)
  if (existing) return { state: existing, created, alreadyExisted: true }

  const name = basename(resolve(root))
  const state = initialForgeState(name, opts)
  await writeForgeState(root, state)
  created.push(forgeStatePath(root))

  const intake = join(dir, '00-intake.md')
  if (!existsSync(intake)) {
    await writeFile(intake, INTAKE_STUB(name, opts.idea), 'utf8')
    created.push(intake)
  }
  return { state, created, alreadyExisted: false }
}
