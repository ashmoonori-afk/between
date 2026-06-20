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

    // --- agent embedding (`between start --embed`) ---
    // 'file' keeps the zero-risk headless path as the default; 'oneshot' spawns the agent
    // per signal (zero native deps); 'pty' hosts a live ConPTY terminal (optional node-pty).
    agent_mode: z.enum(['file', 'oneshot', 'pty']).default('file'),
    developer_command: z.string().default('node .between/agents/fake-agent.mjs developer'),
    reviewer_command: z.string().default('node .between/agents/fake-agent.mjs reviewer'),
    agent_cwd: z.string().default(''), // '' resolves to the project root
    agent_pane_scrollback: z.number().int().positive().default(2000),
    agent_pane_visible_rows: z.number().int().positive().default(10),

    // --- gateway (chat bridge: `between gateway`) ---
    gateway_channel: z.enum(['echo', 'telegram', 'discord']).default('echo'),
    telegram_bot_token: z.string().default(''),
    telegram_chat_id: z.string().default(''),
    discord_bot_token: z.string().default(''),
    discord_channel_id: z.string().default(''),
    // 'gateway' = realtime WebSocket (needs the MESSAGE_CONTENT privileged intent);
    // 'poll' = REST channel polling (no privileged intent, replays missed messages).
    discord_mode: z.enum(['gateway', 'poll']).default('gateway'),
    discord_poll_interval_ms: z.number().int().positive().default(4000),

    // --- verification runner (`between verify`, B3) ---
    verification_checks: z.array(z.object({ name: z.string(), command: z.string() })).default([
      { name: 'typecheck', command: 'npm run typecheck' },
      { name: 'lint', command: 'npm run lint' },
      { name: 'tests', command: 'npm test' },
    ]),
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

# --- human gate (§7) --- (reserved: approval is enforced via the human_gate phase + token,
# not yet by these per-action booleans; see docs/AGENT-CONTRACT.md trust-boundary note)
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

# --- rule promotion (§13) --- (reserved: not yet implemented in the runtime loop)
auto_propose_rules: true
auto_promote_rules: false        # never auto-harden a rule without a human
promotion_requires_human: true

# --- agent embedding (between start --embed) ---
agent_mode: file                 # file | oneshot | pty
developer_command: 'node .between/agents/fake-agent.mjs developer'
reviewer_command: 'node .between/agents/fake-agent.mjs reviewer'
agent_cwd: ''                    # '' = project root
agent_pane_scrollback: 2000      # lines retained per agent pane
agent_pane_visible_rows: 10      # visible tail rows per agent pane

# --- gateway (between gateway: chat <-> broker bridge) ---
gateway_channel: echo            # echo | telegram | discord
telegram_bot_token: ''           # @BotFather token (or set BETWEEN_TELEGRAM_TOKEN)
telegram_chat_id: ''             # chat to notify (optional; learned from first message)
discord_bot_token: ''            # Discord bot token (or set BETWEEN_DISCORD_TOKEN)
discord_channel_id: ''           # channel to notify (required for discord_mode: poll)
discord_mode: gateway            # gateway (realtime WS, needs MESSAGE_CONTENT intent) | poll (REST, no privileged intent)
discord_poll_interval_ms: 4000   # poll cadence when discord_mode: poll
`
}
