import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { parseConfig } from '../../src/core/config-schema'
import { updateIdeConfig } from '../../src/ide/config'

describe('updateIdeConfig', () => {
  it('updates project-local IDE topology while preserving comments', async () => {
    const root = await seedConfig(`schema_version: 1
builder_agent_count: 1 # keep builder comment
reviewer_agent_count: 1
ide_cli_rules_mode: inherit_global
ide_cli_profile_dir: .between/ide-profile
ide_permission_mode: guard
ide_working_folder: .
ide_followup_mode: steer
`)
    try {
      const cfg = await updateIdeConfig(root, {
        builderAgentCount: 4,
        reviewerAgentCount: 2,
        rulesMode: 'project_only',
        profileDir: '.between/ide-profile/codex-local',
        permissionMode: 'full_access',
        workingFolder: 'packages/app',
        followupMode: 'queue',
      })
      const body = await readFile(join(root, '.between', 'config.yaml'), 'utf8')

      expect(cfg.builder_agent_count).toBe(4)
      expect(cfg.reviewer_agent_count).toBe(2)
      expect(cfg.ide_cli_rules_mode).toBe('project_only')
      expect(cfg.ide_cli_profile_dir).toBe('.between/ide-profile/codex-local')
      expect(cfg.ide_permission_mode).toBe('full_access')
      expect(cfg.ide_working_folder).toBe('packages/app')
      expect(cfg.ide_followup_mode).toBe('queue')
      expect(body).toContain('builder_agent_count: 4 # keep builder comment')
      expect(body).toContain('ide_permission_mode: full_access')
      expect(body).toContain('ide_working_folder: "packages/app"')
      expect(body).toContain('ide_followup_mode: queue')
      expect(parseConfig(parseYaml(body)).builder_agent_count).toBe(4)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves quoted hash characters when rewriting IDE working folders', async () => {
    const root = await seedConfig(`schema_version: 1
builder_agent_count: 1
reviewer_agent_count: 1
ide_cli_rules_mode: project_only
ide_cli_profile_dir: .between/ide-profile
ide_permission_mode: guard
ide_working_folder: "packages/#old" # keep working-folder comment
ide_followup_mode: steer
`)
    try {
      const cfg = await updateIdeConfig(root, { workingFolder: 'packages/#app' })
      const body = await readFile(join(root, '.between', 'config.yaml'), 'utf8')

      expect(cfg.ide_working_folder).toBe('packages/#app')
      expect(body).toContain('ide_working_folder: "packages/#app" # keep working-folder comment')
      expect(body).not.toContain('packages/#app"#old')
      expect(parseConfig(parseYaml(body)).ide_working_folder).toBe('packages/#app')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects invalid counts and profile paths before saving', async () => {
    const root = await seedConfig(`schema_version: 1
builder_agent_count: 1
reviewer_agent_count: 1
ide_cli_profile_dir: .between/ide-profile
ide_permission_mode: guard
ide_working_folder: .
ide_followup_mode: steer
`)
    try {
      await expect(updateIdeConfig(root, { builderAgentCount: 0 })).rejects.toThrow(/agent count/)
      await expect(updateIdeConfig(root, { profileDir: '../outside' })).rejects.toThrow(
        /ide_cli_profile_dir/,
      )
      await expect(updateIdeConfig(root, { permissionMode: 'root' })).rejects.toThrow(
        /permission mode/,
      )
      await expect(updateIdeConfig(root, { workingFolder: '../outside' })).rejects.toThrow(
        /ide_working_folder/,
      )
      await expect(updateIdeConfig(root, { followupMode: 'overwrite' })).rejects.toThrow(
        /follow-up mode/,
      )
      const body = await readFile(join(root, '.between', 'config.yaml'), 'utf8')
      expect(body).toContain('builder_agent_count: 1')
      expect(body).toContain('ide_cli_profile_dir: .between/ide-profile')
      expect(body).toContain('ide_permission_mode: guard')
      expect(body).toContain('ide_working_folder: .')
      expect(body).toContain('ide_followup_mode: steer')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not write global Codex config while updating local topology', async () => {
    const root = await seedConfig(`schema_version: 1
builder_agent_count: 1
reviewer_agent_count: 1
`)
    const home = await mkdtemp(join(tmpdir(), 'between-home-'))
    const oldHome = process.env.HOME
    const oldUserProfile = process.env.USERPROFILE
    process.env.HOME = home
    process.env.USERPROFILE = home
    try {
      await updateIdeConfig(root, { builderAgentCount: 2 })

      expect(existsSync(join(home, '.codex'))).toBe(false)
    } finally {
      process.env.HOME = oldHome
      process.env.USERPROFILE = oldUserProfile
      await rm(root, { recursive: true, force: true })
      await rm(home, { recursive: true, force: true })
    }
  })
})

async function seedConfig(body: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'between-ide-config-'))
  await mkdir(join(root, '.between'), { recursive: true })
  await writeFile(join(root, '.between', 'config.yaml'), body, 'utf8')
  return root
}
