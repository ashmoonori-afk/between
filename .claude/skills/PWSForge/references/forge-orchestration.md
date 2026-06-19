# PWSForge Forge-Master Orchestration Reference

## Purpose

This reference upgrades PWSForge from a linear app-building coach into a professional forge-master workflow. The main PWSForge agent remains accountable for product coherence, sequencing, user explanation, approval boundaries, and verification, while specialist skills and subagents are called only when they improve the result.

The design follows current agentic-system best practice: start with the simplest reliable workflow, keep specs modular and testable, use routing and parallel workers only for clear specialist work, and separate creation from independent evaluation.

## Research Notes Incorporated

- Anthropic's agent design guidance emphasizes simple, composable patterns over complex frameworks, and recommends increasing agentic complexity only when it measurably improves outcomes. PWSForge therefore defaults to prompt chaining and adds routing, parallelization, orchestrator-workers, evaluator-optimizer loops, or autonomous agents only as needed.
- Strong AI-coding specs should be concise, structured, modular, testable, and maintained as persistent project files. PWSForge therefore requires PRD, UI, architecture, implementation plan, task briefs, QA, release checklist, decision log, and state files for professional builds.
- Professional PRDs/SRS-style specs should include objectives, users, constraints, features, technical requirements, user stories, acceptance criteria, and verification commands. PWSForge uses those as gates before implementation.

## Operating Model

### 1. Main Agent Responsibilities

The PWSForge main agent must:

1. Maintain the phase order.
2. Explain tradeoffs in the user's language.
3. Decide when another skill/subagent is warranted.
4. Create or update project artifacts.
5. Resolve conflicts between specialist outputs.
6. Verify final work with tools before reporting success.
7. Preserve approval boundaries for installs, credentials, payments, production changes, uploads, and submissions.

### 2. Specialist Skill Responsibilities

Specialist skills may handle:

- Codebase inspection.
- TDD and implementation.
- Systematic debugging.
- UI design exploration.
- GitHub workflows.
- Code review/security review.
- Research and benchmarking.
- Document parsing and generation.
- Deployment and release packaging.

Specialist outputs are advisory until PWSForge verifies them.

### 3. Delegation Rule

Delegate only when at least one is true:

- The task requires specialized skill instructions.
- The work can run independently in parallel.
- A second perspective materially improves quality or risk control.
- The implementation is large enough to benefit from separate frontend/backend/test/docs lanes.
- Review must be separated from implementation.

Do not delegate just to appear sophisticated.

## Workflow Patterns

### Prompt Chaining

Default for the lifecycle:

```text
Intake → Interview → Startup PRD → UI Direction → Handoff PRD → Architecture/Stack → Implementation Plan → Build → QA → Release → Retrospective
```

Use gates between phases. If a gate fails, either ask the user or record assumptions and risks if the user insists on moving forward.

### Routing

Route tasks to a specialized skill when the domain is clear.

Examples:

- Failing tests → systematic-debugging.
- Feature build with acceptance criteria → test-driven-development.
- Large implementation plan → subagent-driven-development.
- Existing repo analysis → codebase-inspection.
- Branch/PR/release → github-pr-workflow.
- UX exploration → sketch, popular-web-designs, claude-design.
- Code review → requesting-code-review or github-code-review.

### Parallelization

Use parallel research or review when tasks are independent:

- Stack comparison: Next.js/Supabase vs. FastAPI/Postgres vs. Firebase.
- Competitor/product benchmark.
- UI reference scan.
- Security/privacy risk scan.
- Release policy scan.

Merge results into one decision memo with sources and recommendation.

### Orchestrator-Workers

Use for larger builds after requirements are stable.

Recommended lanes:

- Frontend/UI lane.
- Backend/API lane.
- Data model/migration lane.
- Test/QA lane.
- Documentation/release lane.

The main PWSForge agent must integrate, resolve conflicts, and run final verification.

### Evaluator-Optimizer

Use two-pass creation and critique for:

- PRD.
- Handoff PRD.
- UI flow.
- Architecture.
- Security-sensitive code.
- Release checklist.
- Store metadata.

Pattern:

1. Draft.
2. Critique against acceptance criteria, risks, and user context.
3. Revise.
4. Verify.

## Professional Project Artifact Contract

For a serious build, create or maintain:

```text
docs/pwsforge/
  00-intake.md
  01-interview-notes.md
  02-startup-prd.md
  03-ui-direction.md
  04-screen-flow.md
  05-handoff-prd.md
  06-architecture.md
  07-tech-stack-decision.md
  08-implementation-plan.md
  09-task-briefs/
  10-qa-checklist.md
  11-release-checklist.md
  12-decision-log.md
  state.json
```

### state.json Minimum Fields

```json
{
  "project_name": "",
  "current_phase": "intake|interview|prd|ui|handoff|architecture|plan|build|qa|release|retrospective",
  "platform_priority": [],
  "approved_assumptions": [],
  "selected_stack": {},
  "open_questions": [],
  "open_blockers": [],
  "last_verified_command": "",
  "last_verified_result": "",
  "next_recommended_action": ""
}
```

## Task Brief Template

Use this before delegating to a subagent or specialized coding workflow:

```markdown
# PWSForge Task Brief

## Product Context
- Product:
- Target user:
- Problem:
- Current phase:

## Scope
- Do:
- Do not:

## Inputs
- Repo/path:
- Relevant files:
- Existing docs:
- Design/PRD references:

## Acceptance Criteria
- [ ]
- [ ]
- [ ]

## Verification Required
- Command(s):
- Manual checks:
- Artifact to return:

## Constraints
- Security/privacy:
- Style/UX:
- Performance:
- Budget/API/account limits:
- Approval boundaries:

## Return Format
- Changed files:
- Commands run and output summary:
- Decisions made:
- Blockers:
- Verification evidence:
```

## Architecture Decision Template

```markdown
# Architecture Decision

## Context

## Options Compared
| Option | Pros | Cons | Cost/Risk | Fit |
|---|---|---|---|---|

## Recommendation

## System Shape
- Frontend:
- Backend/API:
- Database:
- Auth:
- Storage:
- AI/automation:
- Integrations:
- Hosting/deployment:
- Monitoring/logging:

## Security and Privacy

## Migration / Rollback

## Verification Plan
```

## Quality Gates

### Product Gate

- Clear target user.
- Clear problem.
- MVP/non-MVP boundary.
- Success metric.
- First successful user journey.

### UX Gate

- Core screens.
- Screen goals.
- Navigation model.
- Empty/loading/error states.
- Accessibility basics.

### Architecture Gate

- Stack options compared.
- Current docs consulted for important choices.
- Data model drafted.
- Auth/security/privacy considered.
- Deployment path known.
- Cost and lock-in risks recorded.

### Implementation Gate

- Task list split into testable units.
- Acceptance criteria per task.
- Verification command per task.
- Required approvals identified.
- Delegated tasks have task briefs.

### Verification Gate

- Build/test/lint run when available.
- Critical files read back or diff inspected.
- Product flow manually checked when possible.
- Subagent outputs independently verified.
- Blockers reported with evidence.

## Anti-Patterns

1. Starting with coding before PRD/UI/architecture gates.
2. Sending vague tasks to subagents.
3. Letting multiple agents edit overlapping files without integration control.
4. Accepting screenshots, builds, or upload status without verifying the artifact.
5. Over-engineering a simple personal/internal tool.
6. Choosing trendy stacks without current docs, installation check, or release implications.
7. Storing project progress in memory instead of project files.
