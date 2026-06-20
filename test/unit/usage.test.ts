import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readUsageSummary, summarizeUsageRecord } from '../../src/evidence/usage'

let dir: string | null = null

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  dir = null
})

describe('usage telemetry', () => {
  it('sums tokens and cost from recorded agent usage entries', () => {
    expect(
      summarizeUsageRecord({
        schema_version: 1,
        cycle: 3,
        entries: [
          {
            role: 'developer',
            provider: 'claude',
            model: 'claude-sonnet',
            input_tokens: 100,
            output_tokens: 30,
            cost_usd: 0.01,
          },
          {
            role: 'reviewer',
            provider: 'codex',
            model: 'gpt-5-codex',
            total_tokens: 240,
          },
        ],
      }),
    ).toEqual({
      input_tokens: 100,
      output_tokens: 30,
      total_tokens: 370,
      cost_usd: 0.01,
      entries: [
        {
          role: 'developer',
          provider: 'claude',
          model: 'claude-sonnet',
          input_tokens: 100,
          output_tokens: 30,
          total_tokens: 130,
          cost_usd: 0.01,
        },
        {
          role: 'reviewer',
          provider: 'codex',
          model: 'gpt-5-codex',
          input_tokens: null,
          output_tokens: null,
          total_tokens: 240,
          cost_usd: null,
        },
      ],
    })
  })

  it('reads only matching-cycle usage files and rejects malformed telemetry', async () => {
    dir = await mkdtemp(join(tmpdir(), 'between-usage-'))
    const path = join(dir, 'cycle-0003.json')
    await writeFile(
      path,
      JSON.stringify({
        schema_version: 1,
        cycle: 3,
        entries: [{ role: 'reviewer', total_tokens: 12, cost_usd: 0.001 }],
      }),
      'utf8',
    )

    expect(await readUsageSummary(path, 3)).toMatchObject({ total_tokens: 12, cost_usd: 0.001 })
    expect(await readUsageSummary(path, 4)).toBeNull()

    await writeFile(
      path,
      '{"schema_version":1,"cycle":3,"entries":[{"role":"","total_tokens":-1}]}',
    )
    expect(await readUsageSummary(path, 3)).toBeNull()
  })
})
