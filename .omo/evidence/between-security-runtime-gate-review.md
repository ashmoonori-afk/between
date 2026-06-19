recommendation: REJECT

originalIntent:
- The user requested a read-only gate review for Between focused only on security, supply-chain, and runtime correctness.
- The expected decision is whether dependency engines, CI Node matrix, lockfile state, docs, and evidence have been correctly assessed, and whether evidence contains secrets or PII beyond temp paths.

desiredOutcome:
- Approve only if the runtime support contract is consistent across package metadata, lockfile, build target, CI, and docs.
- Approve only if evidence supports the claims without leaking secrets or non-temp PII/local identifiers.
- Approve only if the review artifact itself has completed security/supply-chain/runtime coverage, not pending placeholders.

userOutcomeReview:
- The shipped artifacts do not provide a clean approvable outcome for the user. The reviewed files correctly identify some runtime risks, but the repo still has inconsistent Node support metadata, red CI evidence, a downgraded/missing lint gate, and evidence files with non-temp absolute workspace paths.

blockers:
- CI/runtime gate is red. review.md lines 44-52 reports npm test and npm run test:cov failing; .github/workflows/ci.yml lines 23-29 runs npm ci, typecheck, test:cov, and build, so the configured CI path is not green.
- Node support contract is inconsistent. package.json lines 10-11 requires node >=22.12.0, but package-lock.json lines 39-40 still has root engines node >=20. README.md line 19 and DEVELOPMENT-PLAN.md line 28 still state Node.js 20 LTS. tsup.config.ts line 6 still targets node20. CI main matrix is node 22/24 at .github/workflows/ci.yml lines 15-16, while optional-pty-build still uses node 20 at lines 43-47.
- Lockfile was not regenerated for the engine change. Direct JSON read showed package engines {"node":">=22.12.0"} and lock root engines {"node":">=20"} with dependency spec diff count 0, confirming the stale field is specifically the root engine metadata.
- Quality/security evidence is incomplete. review.md lines 75-80 leaves the Sub-Reviewer Gate entries pending, including Security/supply-chain. That does not satisfy a completed gate report.
- Lint gate is false confidence for security/runtime review. package.json line 24 maps lint to Prettier only, and CI lines 23-29 do not run lint at all, while DEVELOPMENT-PLAN.md lines 41-43 and 185-188 describe lint as part of the required gate.
- Evidence contains non-temp local path PII beyond temp paths. Examples: .omo/evidence/task-5-automated-verification.txt lines 21 and 79 include C:/Users/lg/marketing for companies/between, line 140 includes C:\Users\lg\marketing for companies\between\tsup.config.ts, and .omo/evidence/between-ulw-review/build-current.txt line 8 includes the same workspace path. Temp-path evidence exists too, but these examples are not temp paths.
- npm audit found one low-severity dev/transitive advisory for esbuild in the full dependency graph; npm audit --omit=dev was clean. This is not the primary blocker, but review.md does not document the supply-chain audit state.

direct_skill_perspective_check:
- remove-ai-slops pass: No approval. The changed package/CI/docs surface creates false confidence by naming Prettier-only formatting as lint and omitting lint from CI. The review report also leaves sub-reviewer security/supply-chain coverage pending. No deletion-only or tautological tests were found in the requested artifact set because test files were outside the user's review scope.
- programming pass: No code edits were made. Runtime metadata must be a single source of truth; current package, lockfile, CI, build target, and docs contradict each other.

checkedArtifactPaths:
- review.md
- package.json
- package-lock.json
- .github/workflows/ci.yml
- README.md
- DEVELOPMENT-PLAN.md
- tsup.config.ts
- vitest.config.ts
- .omo/evidence/task-5-automated-verification.txt
- .omo/evidence/task-3-runtime-compat.txt
- .omo/evidence/task-3-node20-runtime.txt
- .omo/evidence/task-2-interval-runtime.txt
- .omo/evidence/task-5-lint.txt
- .omo/evidence/task-6-real-cli-tui.txt
- .omo/evidence/task-7-cli-error-paths.txt
- .omo/evidence/between-ulw-review/visual-qa-tui.txt
- .omo/evidence/between-ulw-review/build-current.txt

exactEvidenceGaps:
- No completed security/supply-chain sub-review is present in review.md; the relevant line remains pending.
- Evidence supports the CI-red finding, but no artifact shows the runtime metadata drift fixed.
- Evidence supports Node 20 smoke success for limited commands, but that does not prove Node 20 support against dependencies whose lockfile engines require Node >=22 for commander/Ink-related packages.
- Evidence includes non-temp absolute workspace paths and therefore is not clean for sharing as-is.
