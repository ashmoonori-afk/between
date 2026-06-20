import { readFile } from 'node:fs/promises'
import { z } from 'zod'

const UsageEntrySchema = z.object({
  role: z.string().min(1),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
})

const UsageRecordSchema = z.object({
  schema_version: z.literal(1),
  cycle: z.number().int().nonnegative(),
  entries: z.array(UsageEntrySchema).default([]),
})

export type UsageRecord = z.infer<typeof UsageRecordSchema>

export interface EvidenceUsageEntry {
  role: string
  provider?: string
  model?: string
  input_tokens: number | null
  output_tokens: number | null
  total_tokens: number
  cost_usd: number | null
}

export interface EvidenceUsageSummary {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number | null
  entries: EvidenceUsageEntry[]
}

export async function readUsageSummary(
  path: string,
  cycle: number,
): Promise<EvidenceUsageSummary | null> {
  try {
    const record = UsageRecordSchema.parse(JSON.parse(await readFile(path, 'utf8')))
    if (record.cycle !== cycle) return null
    return summarizeUsageRecord(record)
  } catch {
    return null
  }
}

export function summarizeUsageRecord(record: UsageRecord): EvidenceUsageSummary {
  const entries = record.entries.map((entry): EvidenceUsageEntry => {
    const input = entry.input_tokens ?? null
    const output = entry.output_tokens ?? null
    const total = entry.total_tokens ?? (entry.input_tokens ?? 0) + (entry.output_tokens ?? 0)
    return {
      role: entry.role,
      ...(entry.provider ? { provider: entry.provider } : {}),
      ...(entry.model ? { model: entry.model } : {}),
      input_tokens: input,
      output_tokens: output,
      total_tokens: total,
      cost_usd: entry.cost_usd ?? null,
    }
  })
  const costs = entries.flatMap((entry) => (entry.cost_usd === null ? [] : [entry.cost_usd]))
  return {
    input_tokens: entries.reduce((sum, entry) => sum + (entry.input_tokens ?? 0), 0),
    output_tokens: entries.reduce((sum, entry) => sum + (entry.output_tokens ?? 0), 0),
    total_tokens: entries.reduce((sum, entry) => sum + entry.total_tokens, 0),
    cost_usd: costs.length === 0 ? null : costs.reduce((sum, value) => sum + value, 0),
    entries,
  }
}
