import { z } from 'zod'

export const CLAUDE_MODELS = ['fable', 'opus', 'sonnet', 'haiku'] as const
export const CODEX_FALLBACK_MODELS = ['gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'gpt-5.5'] as const

const MODEL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,99}$/
const ModelNameSchema = z.string().regex(MODEL_NAME_PATTERN)
const CodexModelsSchema = z
  .object({
    models: z
      .array(
        z
          .object({
            slug: ModelNameSchema,
            visibility: z.enum(['list', 'hide']),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough()

export class ModelDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelDataError'
  }
}

export class ModelNameError extends Error {
  readonly model: string

  constructor(model: string) {
    super(
      'model must be 1-100 characters and contain only letters, digits, dot, underscore, colon, brackets, or hyphen',
    )
    this.name = 'ModelNameError'
    this.model = model
  }
}

export function validateModelName(model: string): string {
  if (!MODEL_NAME_PATTERN.test(model)) throw new ModelNameError(model)
  return model
}

export function parseCodexModels(output: string): readonly string[] {
  let value: unknown
  try {
    value = JSON.parse(output)
  } catch {
    throw new ModelDataError('Codex model listing was not valid JSON')
  }
  const parsed = CodexModelsSchema.safeParse(value)
  if (!parsed.success) throw new ModelDataError('Codex model listing had an unsupported shape')
  const models = parsed.data.models
    .filter((model) => model.visibility === 'list')
    .map((model) => model.slug)
  if (models.length === 0) throw new ModelDataError('Codex model listing had no visible models')
  return [...new Set(models)]
}

export function suggestModels(requested: string, available: readonly string[]): readonly string[] {
  return available
    .map((model) => ({ model, distance: editDistance(requested, model) }))
    .sort((left, right) => left.distance - right.distance || left.model.localeCompare(right.model))
    .slice(0, 3)
    .map(({ model }) => model)
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const insertion = (current[rightIndex - 1] ?? 0) + 1
      const deletion = (previous[rightIndex] ?? 0) + 1
      const substitution =
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      current.push(Math.min(insertion, deletion, substitution))
    }
    previous = current
  }
  return previous[right.length] ?? left.length
}
