# PWSForge Phase-by-Phase Professional Playbook

## Purpose

This playbook makes PWSForge sharper at every phase. Each phase has a purpose, inputs, specialist triggers, outputs, exit gate, red flags, and escalation rules. Use it when the user asks for a serious product build, when the project has commercial intent, or when quality matters more than speed.

## Severity Levels

Use these labels when reporting risks:

- **P0 blocker:** Cannot safely proceed without user decision, credential, file, or failed verification fix.
- **P1 major risk:** Can proceed only with explicit assumption and documented mitigation.
- **P2 normal risk:** Track in decision log/backlog.
- **P3 polish:** Nice-to-have; do not block MVP.

## Phase 0 — Intake

### Objective

Turn a vague build request into a bounded project setup.

### Required Inputs

- Product idea or problem area.
- Intended user: self, internal team, public users, paying customers, enterprise.
- Platform priority: web, iOS, Android, cross-platform.
- Desired depth: PRD only, prototype, MVP code, production build, release.
- Existing assets: repo, docs, data files, designs, domain, accounts, credentials.

### Specialist Triggers

- Existing repo → load codebase-inspection before technical claims.
- Existing docs/files → document/OCR/spreadsheet skills as needed.
- Business/domain unknown → research skills or web search.

### Outputs

- `docs/pwsforge/00-intake.md`
- Initial `docs/pwsforge/state.json`
- Open questions list.

### Exit Gate

- [ ] App/problem area known.
- [ ] Platform priority known or assumption recorded.
- [ ] Desired build depth known.
- [ ] Existing assets/repo status known.
- [ ] Approval boundaries identified.

### Red Flags

- User asks for production release with no repo/account/requirements.
- User asks to handle sensitive personal/financial/medical data without privacy discussion.
- User asks to automate logins, scraping, or actions that may violate service terms.

## Phase 1 — Deep Interview

### Objective

Extract the minimum product truth needed to avoid building the wrong thing.

### Sharp Questions

Ask one at a time. Prioritize the weakest missing dimension.

1. Who is the first real user?
2. What painful job are they trying to finish?
3. What do they do today instead?
4. What is the first successful user journey?
5. What input does the app receive?
6. What output must it produce?
7. What must be correct for the output to be trusted?
8. What is explicitly out of scope for MVP?
9. What data is sensitive?
10. How will success be measured after one week of use?

### Outputs

- `01-interview-notes.md`
- Updated assumptions and open questions.

### Exit Gate

- [ ] User/problem/job-to-be-done clear.
- [ ] First successful journey clear.
- [ ] MVP and non-goals clear.
- [ ] Success metric clear.
- [ ] Sensitive data and risky integrations identified.

## Phase 2 — Startup PRD

### Objective

Create a product definition understandable to a non-developer and useful for decisions.

### Required Sections

- One-sentence concept.
- User and use case.
- Problem and current workaround.
- Value proposition.
- MVP scope.
- Deferred scope.
- User stories.
- Success metrics.
- Risks, assumptions, dependencies.
- Data sensitivity summary.

### Evaluator Pass

Critique the PRD for:

- Vague user.
- Feature list without problem.
- Missing success metric.
- MVP too large.
- Hidden account/payment/legal/data dependencies.

### Exit Gate

- [ ] A stranger can explain what is being built and why.
- [ ] MVP could be implemented in small tasks.
- [ ] Non-goals prevent scope creep.
- [ ] Risks are visible.

## Phase 3 — UI Direction

### Objective

Define user flow and screen behavior before implementation.

### Required Sections

- Brand/product tone.
- Navigation model.
- Core screens and screen goals.
- Main user flow.
- Empty/loading/error/success states.
- Accessibility basics.
- Mobile/responsive behavior for web products.

### Heuristic Review

Use a lightweight usability review inspired by NN/g heuristics:

- System status visible.
- User language, not internal jargon.
- User can undo/back/cancel.
- Consistent patterns.
- Error prevention and clear recovery.
- Minimal cognitive load.
- Help text where needed.

### Exit Gate

- [ ] Screen inventory complete for MVP.
- [ ] Primary flow has no missing screen.
- [ ] Error/empty/loading states named.
- [ ] UI tone chosen.
- [ ] Accessibility basics acknowledged.

## Phase 4 — Handoff PRD

### Objective

Convert product intent into implementation-ready requirements.

### Required Sections

- Feature requirements.
- Screen requirements.
- Data model draft.
- API/backend behavior.
- Roles/permissions.
- Integrations.
- Analytics/logging.
- Acceptance criteria.
- Edge cases.

### Acceptance Criteria Style

Use testable language:

- Given [state], when [action], then [observable result].
- Include error and empty cases, not only happy paths.

### Exit Gate

- [ ] Every MVP feature has acceptance criteria.
- [ ] Every critical screen has behavior rules.
- [ ] Data entities and ownership are known.
- [ ] Integration assumptions are explicit.

## Phase 5 — Architecture and Tech Stack

### Objective

Choose the simplest stack that can pass product, security, cost, release, and maintenance needs.

### Comparison Requirements

Compare at least two viable paths unless the user fixed a stack. For each option, record:

- Fit to product.
- Complexity.
- Cost.
- Local/dev environment requirements.
- Deployment path.
- Auth/data/storage implications.
- Vendor lock-in.
- Migration/rollback.
- Known risks.

### Professional Checks

- Use current docs/search for nontrivial stack decisions.
- Consider 12-factor principles for deployable web apps: config via environment, backing services, logs, disposability.
- Consider OWASP ASVS-style security controls for auth, access control, validation, file uploads, secrets, and logging.

### Exit Gate

- [ ] Stack alternatives compared.
- [ ] Recommended architecture documented.
- [ ] Security/privacy/cost risks documented.
- [ ] Install/account/deployment requirements known.
- [ ] Verification plan known.

## Phase 6 — Implementation Plan

### Objective

Turn architecture into small, verifiable, delegable tasks.

### Task Requirements

Each task must include:

- Objective.
- Files or areas likely touched.
- Acceptance criteria.
- Verification command/manual check.
- Dependencies.
- Risk/approval needs.
- Delegation target, if any.

### Plan Critique

Before coding, critique for:

- Tasks too large.
- Untestable work.
- Missing data/auth/error states.
- Parallel tasks that would edit same files.
- Release or credential blockers discovered too late.

### Exit Gate

- [ ] Task list covers MVP end-to-end.
- [ ] First task can start without ambiguity.
- [ ] Verification exists for every meaningful task.
- [ ] Delegation briefs exist where needed.

## Phase 7 — Build

### Objective

Implement in small verified increments.

### Execution Rules

- Read before edit.
- Keep one in-progress implementation step at a time unless deliberately using worker lanes.
- Run verification after each meaningful step.
- Commit/checkpoint only after a green verification when using git.
- Record blocker evidence, not guesses.

### Worker Lane Rules

Use lanes only when file overlap is manageable:

- Frontend lane.
- Backend/API lane.
- Data/migration lane.
- Tests/QA lane.
- Docs/release lane.

Main PWSForge integrates and verifies.

### Exit Gate

- [ ] MVP happy path works.
- [ ] Known edge cases handled or documented.
- [ ] Tests/build/lint run or blocker documented.
- [ ] No unverified subagent output remains.

## Phase 8 — QA

### Objective

Verify the product as a user would experience it.

### QA Layers

- Functional: core flows and edge cases.
- UX: clarity, feedback, error recovery.
- Data: import/export, malformed input, data ownership.
- Security/privacy: auth, access control, secrets, file upload safety, sensitive logs.
- Performance: large input, slow network, perceived loading.
- Release: environment variables, build artifacts, deployment settings.

### Exit Gate

- [ ] Critical flows tested.
- [ ] P0/P1 bugs triaged.
- [ ] Release blockers named.
- [ ] Verification evidence saved.

## Phase 9 — Release Preparation

### Objective

Prepare release assets and operational readiness.

### Web Release Checklist

- Domain/hosting decision.
- Environment variables.
- Build command.
- Deploy command.
- Error logging/monitoring plan.
- Privacy/terms/support pages if public.
- SEO/social metadata if public.
- Backup/export plan if user data exists.

### App Store Checklist

- Bundle/package ID.
- Version/build number.
- Icon/splash/screenshots.
- Store descriptions/keywords/category.
- Privacy labels/data safety.
- Demo credentials.
- Review notes.

### Exit Gate

- [ ] Build artifact or deployment target exists.
- [ ] Required metadata/assets drafted.
- [ ] Credentials/account steps separated for user approval.
- [ ] Status accurately labeled: drafted/built/uploaded/submitted/published.

## Phase 10 — Deployment / Upload

### Objective

Deploy or upload without overclaiming.

### Rules

- Production changes need approval.
- Store submission needs explicit final confirmation.
- If blocked by login/2FA/account/payment, stop and say exactly what user must do.
- Verify public URL, uploaded artifact, or dashboard status when possible.

### Exit Gate

- [ ] Deployment/upload status verified.
- [ ] Rollback or recovery path known.
- [ ] User-facing next action clear.

## Phase 11 — Retrospective

### Objective

Preserve useful knowledge without polluting memory with temporary status.

### Outputs

- Decisions made.
- Artifacts created.
- Verification evidence.
- Bugs/blockers.
- vNext backlog.
- Reusable workflow candidates.

### Storage Rules

- User preference → memory.
- Project progress → project docs/state files.
- Repeatable procedure → skill update.
- Automation idea → proposal/checklist.

### Exit Gate

- [ ] Project state updated.
- [ ] Open risks/backlog recorded.
- [ ] Reusable improvements captured or proposed.
