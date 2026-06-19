import { z } from 'zod'

/**
 * The single typed schema for `.between/config.yaml` (I10). All tunables live here;
 * `state.json` holds runtime state only. Keys are forward-declared in full now so
 * later milestones (M4-M7) never reshape the schema. Unknown keys FAIL FAST (`.strict()`).
 */
export const ConfigSchema = z
  .object({
    schema_version: z.number().int().positive().default(1),

    // --- §7 watch / debounce / cycle ---
    watch_interval_seconds: z.number().positive().default(6),
    diff_debounce_seconds: z.number().positive().default(25),
    max_cycles_per_goal: z.number().int().positive().default(8),
    review_timeout_seconds: z.number().positive().default(900),
    /** symmetric to review timeout — was missing in the blueprint (I7) */
    developer_timeout_seconds: z.number().positive().default(900),
    same_hash_review_policy: z.enum(['skip', 'always']).default('skip'),

    // --- §7 human gate ---
    human_gate_required_for_merge: z.boolean().default(true),
    human_gate_required_for_deploy: z.boolean().default(true),

    // --- diff scope (I5, I17) ---
    /** OFF by default, opt-in; always honor .gitignore + secret denylist when on (I17) */
    review_untracked: z.boolean().default(false),
    untracked_file_globs: z.array(z.string()).default([]),
    /** above this size, hash the blob OID instead of inlining content (I5) */
    binary_hash_max_bytes: z.number().int().positive().default(262144),

    // --- snapshots (I18) ---
    snapshot_retention_cycles: z.number().int().positive().default(50),
    snapshot_max_total_mb: z.number().positive().default(200),

    // --- vault (I25) ---
    vault_path: z.string().default(''),

    // --- §13 rule promotion ---
    auto_propose_rules: z.boolean().default(true),
    auto_promote_rules: z.boolean().default(false),
    promotion_requires_human: z.boolean().default(true),
  })
  .strict()

export type BetweenConfig = z.infer<typeof ConfigSchema>

/** The fully-defaulted config (every field has a default, so parsing {} succeeds). */
export const DEFAULT_CONFIG: BetweenConfig = ConfigSchema.parse({})

/**
 * Validate raw (parsed-from-YAML) config and fail fast with a precise, user-facing
 * message naming the offending keys (CLAUDE.md: validate at the boundary).
 */
export function parseConfig(raw: unknown): BetweenConfig {
  const result = ConfigSchema.safeParse(raw ?? {})
  if (!result.success) {
    const lines = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `  - ${path}: ${issue.message}`
    })
    throw new Error(`Invalid config.yaml:\n${lines.join('\n')}`)
  }
  return result.data
}

/** A documented YAML body written by `between init`. */
export function defaultConfigYaml(): string {
  return `# Between configuration. Tunables only; runtime state lives in state.json.
schema_version: 1

# --- watch / debounce / cycle (§7) ---
watch_interval_seconds: 6        # how often the broker polls git
diff_debounce_seconds: 25        # diff must be stable this long before review
max_cycles_per_goal: 8           # safety cap on review cycles per goal
review_timeout_seconds: 900      # reviewer must respond within this -> human_gate
developer_timeout_seconds: 900   # developer must respond within this -> human_gate
same_hash_review_policy: skip    # skip | always

# --- human gate (§7) ---
human_gate_required_for_merge: true
human_gate_required_for_deploy: true

# --- diff scope ---
review_untracked: false          # include untracked files in the review object
untracked_file_globs: []         # when review_untracked: only these globs
binary_hash_max_bytes: 262144    # hash blob OID above this size

# --- snapshots ---
snapshot_retention_cycles: 50    # keep this many recent diff snapshots
snapshot_max_total_mb: 200       # hard cap on snapshot dir size

# --- vault ---
vault_path: ''                   # Obsidian vault root (validated on start)

# --- rule promotion (§13) ---
auto_propose_rules: true
auto_promote_rules: false        # never auto-harden a rule without a human
promotion_requires_human: true
`
}
