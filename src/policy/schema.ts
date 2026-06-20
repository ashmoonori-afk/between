import { z } from 'zod'

/**
 * B2: policy-as-code. A change is classified by the files it touches (`high_risk_paths`); each
 * risk level requires a set of `gates` and an `approvals` rule. Gate VIOLATIONS are explicit
 * results (see engine.ts), not warnings. Known gates: `verification`, `no_blocking_findings`
 * (evaluable now); `secret_scan`, `dependency_audit` are declared but enforced once the
 * VerificationRunner (B3) wires them — until then they are advisory.
 */
/** Known gate names — restricting to an enum makes a typo in policy.yaml fail fast (review). */
const GateName = z.enum(['verification', 'no_blocking_findings', 'secret_scan', 'dependency_audit'])

const ApprovalRule = z.object({
  reviewers: z.number().int().positive(),
  local_human_required: z.boolean(),
})

export const PolicySchema = z
  .object({
    version: z.number().int().positive().default(1),
    high_risk_paths: z
      .array(z.string())
      .default(['src/auth/**', 'infra/**', '**/*.key', '**/secrets/**']),
    gates: z
      .object({
        high: z.array(GateName),
        normal: z.array(GateName),
      })
      .default({
        high: ['verification', 'no_blocking_findings', 'secret_scan'],
        normal: ['verification', 'no_blocking_findings'],
      }),
    approvals: z
      .object({
        high: ApprovalRule,
        normal: ApprovalRule,
      })
      .default({
        high: { reviewers: 2, local_human_required: true },
        normal: { reviewers: 1, local_human_required: false },
      }),
  })
  .strict()

export type Policy = z.infer<typeof PolicySchema>

/** The fully-defaulted policy (parsing {} succeeds), used when no policy file exists. */
export const DEFAULT_POLICY: Policy = PolicySchema.parse({})

export function parsePolicy(raw: unknown): Policy {
  const result = PolicySchema.safeParse(raw ?? {})
  if (!result.success) {
    const lines = result.error.issues.map((i) => {
      const path = i.path.length > 0 ? i.path.join('.') : '(root)'
      return `  - ${path}: ${i.message}`
    })
    throw new Error(`Invalid policy.yaml:\n${lines.join('\n')}`)
  }
  return result.data
}

/** A documented default policy body written by `between policy --init`. */
export function defaultPolicyYaml(): string {
  return `# Between policy-as-code (B2). A change is high-risk if it touches any high_risk_paths glob.
version: 1

# globs that make a change high-risk (more reviewers + a local human)
high_risk_paths:
  - 'src/auth/**'
  - 'infra/**'
  - '**/*.key'
  - '**/secrets/**'

# required gates per risk level (verification + no_blocking_findings enforced now;
# secret_scan / dependency_audit are advisory until the VerificationRunner wires them)
gates:
  high: [verification, no_blocking_findings, secret_scan]
  normal: [verification, no_blocking_findings]

# human approval requirements per risk level
approvals:
  high: { reviewers: 2, local_human_required: true }
  normal: { reviewers: 1, local_human_required: false }
`
}
