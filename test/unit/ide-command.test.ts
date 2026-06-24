import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { defaultConfigYaml, parseConfig } from '../../src/core/config-schema'

describe('between ide command', () => {
  it('prints JSON topology and updates project-local invocation targets', async () => {
    const root = await seedConfig()
    try {
      const json = await runBetween(root, ['ide', '--json'])
      const parsed = JSON.parse(json.stdout)

      expect(parsed.profile.builderAgentCount).toBe(1)
      expect(parsed.profile.panes.map((pane: { target: string }) => pane.target)).toContain(
        'builder:1',
      )

      const printed = await runBetween(root, [
        'ide',
        '--builder-agents',
        '4',
        '--reviewer-agents',
        '2',
        '--rules-mode',
        'project_only',
        '--permission-mode',
        'full_access',
        '--working-folder',
        'packages/app',
        '--followup-mode',
        'queue',
        '--print-cli',
        'reviewer:2',
      ])
      const body = await readFile(join(root, '.between', 'config.yaml'), 'utf8')
      const cfg = parseConfig(parseYaml(body))

      expect(cfg.builder_agent_count).toBe(4)
      expect(cfg.reviewer_agent_count).toBe(2)
      expect(cfg.ide_permission_mode).toBe('full_access')
      expect(cfg.ide_working_folder).toBe('packages/app')
      expect(cfg.ide_followup_mode).toBe('queue')
      expect(printed.stdout).toContain('target: reviewer:2')
      expect(printed.stdout).toContain('BETWEEN_IDE_TARGET="reviewer:2"')
      expect(printed.stdout).toContain('BETWEEN_IDE_PERMISSION_MODE="full_access"')
      expect(printed.stdout).toContain('BETWEEN_IDE_WORKING_FOLDER="packages/app"')
      expect(printed.stdout).toContain('BETWEEN_IDE_FOLLOWUP_MODE="queue"')
      expect(printed.stdout).toContain('CODEX_HOME=')
      expect(printed.stdout).toContain('bypasses_broker_policy: false')
      expect(printed.stdout).toContain('broker policy still enforced')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rewrites hash-containing working folders without corrupting YAML comments', async () => {
    const root = await seedConfig()
    try {
      await runBetween(root, ['ide', '--working-folder', 'packages/#old'])
      const printed = await runBetween(root, [
        'ide',
        '--working-folder',
        'packages/#app',
        '--print-cli',
        'builder:1',
      ])
      const body = await readFile(join(root, '.between', 'config.yaml'), 'utf8')
      const cfg = parseConfig(parseYaml(body))

      expect(cfg.ide_working_folder).toBe('packages/#app')
      expect(body).toContain('ide_working_folder: "packages/#app"')
      expect(body).not.toContain('packages/#app"#old')
      expect(printed.stdout).toContain('BETWEEN_IDE_WORKING_FOLDER="packages/#app"')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects invalid agent counts', async () => {
    const root = await seedConfig()
    try {
      const result = await runBetween(root, ['ide', '--builder-agents', '0'], false)

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('agent count must be an integer from 1 to 16')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects invalid IDE task controls', async () => {
    const root = await seedConfig()
    try {
      const permission = await runBetween(root, ['ide', '--permission-mode', 'root'], false)
      const workingFolder = await runBetween(root, ['ide', '--working-folder', '../outside'], false)
      const followup = await runBetween(root, ['ide', '--followup-mode', 'overwrite'], false)

      expect(permission.exitCode).not.toBe(0)
      expect(permission.stderr).toContain(
        '--permission-mode must be read_only, guard, or full_access',
      )
      expect(workingFolder.exitCode).not.toBe(0)
      expect(workingFolder.stderr).toContain('ide_working_folder')
      expect(followup.exitCode).not.toBe(0)
      expect(followup.stderr).toContain('--followup-mode must be steer or queue')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

async function seedConfig(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'between-ide-command-'))
  await mkdir(join(root, '.between'), { recursive: true })
  await writeFile(
    join(root, '.between', 'config.yaml'),
    defaultConfigYaml().replace(
      "reviewer_command: 'node .between/agents/fake-agent.mjs reviewer'",
      "reviewer_command: 'node .between/agents/codex-agent.mjs reviewer'",
    ),
    'utf8',
  )
  return root
}

async function runBetween(root: string, args: string[], reject = true) {
  return execa(
    process.execPath,
    [
      '--import',
      pathToFileURL(join(process.cwd(), 'node_modules/tsx/dist/loader.mjs')).href,
      join(process.cwd(), 'src/cli.ts'),
      ...args,
    ],
    {
      cwd: root,
      reject,
    },
  )
}
