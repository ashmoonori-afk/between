import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { reviewerOneShotCommand } from '../../src/ui/start'

let dir = ''

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = ''
})

describe('reviewerOneShotCommand', () => {
  it('uses the generated Codex wrapper for direct codex reviewer config', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-start-command-'))
    await mkdir(join(dir, '.between', 'agents'), { recursive: true })
    await writeFile(join(dir, '.between', 'agents', 'codex-agent.mjs'), '', 'utf8')

    expect(reviewerOneShotCommand(dir, 'codex')).toBe(
      'node .between/agents/codex-agent.mjs reviewer',
    )
  })

  it('leaves custom reviewer commands unchanged', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-start-command-'))

    expect(reviewerOneShotCommand(dir, 'custom-reviewer --flag')).toBe('custom-reviewer --flag')
  })
})
