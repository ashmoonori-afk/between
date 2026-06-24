import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function readCommands(root: string): Promise<Array<Record<string, unknown>>> {
  const dir = join(root, '.between', 'commands')
  const names = await readdir(dir)
  return Promise.all(
    names.sort().map(async (name) => JSON.parse(await readFile(join(dir, name), 'utf8'))),
  )
}

export async function seedWorkspace(
  options: { evidenceTrust?: 'real' | 'simulated'; writeBundle?: boolean } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'between-vscode-workspace-'))
  await mkdir(join(root, '.git'), { recursive: true })
  await mkdir(join(root, '.between', 'reviews'), { recursive: true })
  await mkdir(join(root, '.between', 'bundles'), { recursive: true })
  await writeFile(
    join(root, '.between', 'config.yaml'),
    `schema_version: 1
ide_cli_rules_mode: project_only
ide_cli_profile_dir: .between/ide-profile
ide_permission_mode: guard
ide_working_folder: packages/app
ide_followup_mode: steer
`,
  )
  await writeFile(join(root, '.git', 'between-approval.key'), 'ide-secret\n')
  await writeFile(join(root, 'app.ts'), 'const a = 1\nconst b = 2\n')
  await writeFile(join(root, '.between', 'state.json'), stateJson(root, options))
  await writeFile(join(root, '.between', 'reviews', 'cycle-0001.json'), reviewJson())
  if (options.writeBundle !== false) {
    await writeFile(join(root, '.between', 'bundles', `${'b'.repeat(64)}.json`), bundleJson())
  }
  return root
}

function stateJson(
  root: string,
  options: { evidenceTrust?: 'real' | 'simulated'; writeBundle?: boolean },
): string {
  return JSON.stringify({
    project: { name: 'demo', root, obsidian_project_path: null },
    workflow: { phase: 'human_gate', cycle: 1 },
    diff: { hash: 'd'.repeat(64), bundle_id: 'b'.repeat(64) },
    evidence_trust: options.evidenceTrust ?? 'real',
    developer: { name: 'claude' },
    reviewer: { name: 'codex' },
    approval: null,
  })
}

function reviewJson(): string {
  return JSON.stringify({
    cycle: 1,
    diff_hash: 'd'.repeat(64),
    complete: true,
    findings: [
      {
        id: 'F1',
        severity: 'blocking',
        summary: '[app.ts:2] missing guard',
        target_hash: 'd'.repeat(64),
      },
      { id: 'F2', severity: 'non-blocking', summary: '[app.ts:3] old note', target_hash: 'old' },
    ],
  })
}

function bundleJson(): string {
  return JSON.stringify({
    bundle_id: 'b'.repeat(64),
    diff_hash: 'd'.repeat(64),
    repository: { head_sha: 'a'.repeat(40), branch: 'main' },
    diff: {
      tracked: 'diff --git a/app.ts b/app.ts\n@@ -1,1 +1,2 @@\n const a = 1\n+const b = 2\n',
    },
  })
}
