import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { submitBetweenAction } from '../src/workspace.js'
import { seedWorkspace } from './workspace-fixtures'

describe('workspace IDE control-plane actions', () => {
  it('preserves existing IDE control-plane values when only topology counts change', async () => {
    const root = await seedWorkspace()
    await submitBetweenAction(root, {
      kind: 'configure_topology',
      builderAgentCount: 3,
      reviewerAgentCount: 2,
      permissionMode: 'full_access',
      workingFolder: 'packages/app',
      followupMode: 'queue',
    })

    await submitBetweenAction(root, {
      kind: 'configure_topology',
      builderAgentCount: 4,
      reviewerAgentCount: 2,
    })

    const config = await readFile(join(root, '.between', 'config.yaml'), 'utf8')
    expect(config).toContain('builder_agent_count: 4')
    expect(config).toContain('ide_permission_mode: full_access')
    expect(config).toContain('ide_working_folder: "packages/app"')
    expect(config).toContain('ide_followup_mode: queue')
  })

  it('preserves quoted working folders that contain hash characters', async () => {
    const root = await seedWorkspace()
    await writeFile(
      join(root, '.between', 'config.yaml'),
      `schema_version: 1
builder_agent_count: 3
reviewer_agent_count: 2
ide_cli_rules_mode: project_only
ide_permission_mode: guard
ide_working_folder: "packages/#app"
ide_followup_mode: queue
`,
    )

    const result = await submitBetweenAction(root, {
      kind: 'configure_topology',
      builderAgentCount: 4,
      reviewerAgentCount: 2,
    })

    const config = await readFile(join(root, '.between', 'config.yaml'), 'utf8')
    expect(result).toMatchObject({ workingFolder: 'packages/#app' })
    expect(config).toContain('builder_agent_count: 4')
    expect(config).toContain('ide_working_folder: "packages/#app"')
    expect(config).not.toContain('packages/"#app')
  })

  it('rejects invalid IDE control-plane values without changing config', async () => {
    const root = await seedWorkspace()
    await submitBetweenAction(root, {
      kind: 'configure_topology',
      builderAgentCount: 3,
      reviewerAgentCount: 2,
      permissionMode: 'guard',
      workingFolder: 'packages/app',
      followupMode: 'steer',
    })
    const before = await readFile(join(root, '.between', 'config.yaml'), 'utf8')

    await expect(
      submitBetweenAction(root, {
        kind: 'configure_topology',
        builderAgentCount: 3,
        reviewerAgentCount: 2,
        permissionMode: 'root',
        workingFolder: 'packages/app',
        followupMode: 'steer',
      }),
    ).rejects.toThrow(/permissionMode/)
    await expect(
      submitBetweenAction(root, {
        kind: 'configure_topology',
        builderAgentCount: 3,
        reviewerAgentCount: 2,
        permissionMode: 'guard',
        workingFolder: '../outside',
        followupMode: 'steer',
      }),
    ).rejects.toThrow(/workingFolder/)
    await expect(
      submitBetweenAction(root, {
        kind: 'configure_topology',
        builderAgentCount: 3,
        reviewerAgentCount: 2,
        permissionMode: 'guard',
        workingFolder: 'packages/app',
        followupMode: 'overwrite',
      }),
    ).rejects.toThrow(/followupMode/)

    expect(await readFile(join(root, '.between', 'config.yaml'), 'utf8')).toBe(before)
  })
})
