# PWSForge Phase Gate Scorecard

Use this scorecard at the end of each phase. Do not expose all scoring detail to non-developer users unless helpful; summarize blockers and the next decision.

Scoring:

- 0 = missing
- 1 = weak / assumed
- 2 = clear enough
- 3 = strong / verified

Gate rule:

- Any P0 blocker stops progression.
- Any item scored 0 in a required gate must be asked, researched, or explicitly assumed with risk.
- Average below 2.0 means the phase is not ready for professional build progression.

## Phase 0 Intake

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| Product/problem area identified |  |  |  |
| Platform priority identified |  |  |  |
| Desired output depth identified |  |  |  |
| Existing repo/assets/data status known |  |  |  |
| Approval boundaries known |  |  |  |

## Phase 1 Deep Interview

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| First user clear |  |  |  |
| Core problem/job-to-be-done clear |  |  |  |
| Current workaround known |  |  |  |
| First successful journey clear |  |  |  |
| Inputs and outputs known |  |  |  |
| Trust/correctness requirement known |  |  |  |
| MVP/non-goals clear |  |  |  |
| Success metric clear |  |  |  |
| Sensitive data risks identified |  |  |  |

## Phase 2 Startup PRD

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| One-sentence concept strong |  |  |  |
| Problem/user/value aligned |  |  |  |
| MVP scope small enough |  |  |  |
| Deferred scope prevents creep |  |  |  |
| User stories testable |  |  |  |
| Success metrics measurable |  |  |  |
| Risks/assumptions documented |  |  |  |

## Phase 3 UI Direction

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| Core screen inventory complete |  |  |  |
| Primary flow complete |  |  |  |
| Navigation model chosen |  |  |  |
| Empty/loading/error states named |  |  |  |
| Accessibility basics covered |  |  |  |
| Visual tone/style decided |  |  |  |

## Phase 4 Handoff PRD

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| Feature requirements precise |  |  |  |
| Screen requirements precise |  |  |  |
| Data model drafted |  |  |  |
| API/backend behavior described |  |  |  |
| Roles/permissions clear |  |  |  |
| Edge cases included |  |  |  |
| Acceptance criteria testable |  |  |  |

## Phase 5 Architecture / Stack

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| At least two stack options compared or fixed by user |  |  |  |
| Current docs/status checked |  |  |  |
| Architecture shape documented |  |  |  |
| Security/privacy risks documented |  |  |  |
| Cost/lock-in risks documented |  |  |  |
| Deployment path known |  |  |  |
| Install/account requirements known |  |  |  |
| Verification plan known |  |  |  |

## Phase 6 Implementation Plan

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| Tasks cover MVP end-to-end |  |  |  |
| Tasks are small and ordered |  |  |  |
| Acceptance criteria per task |  |  |  |
| Verification command per task |  |  |  |
| Dependencies clear |  |  |  |
| Delegation briefs ready where needed |  |  |  |
| Plan critique completed |  |  |  |

## Phase 7 Build

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| Existing files inspected before edits |  |  |  |
| Implemented increment matches task |  |  |  |
| Tests/lint/build run or blocker documented |  |  |  |
| Subagent output independently verified |  |  |  |
| State/docs updated |  |  |  |

## Phase 8 QA

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| Happy path tested |  |  |  |
| Edge/error cases tested |  |  |  |
| UX heuristic pass completed |  |  |  |
| Security/privacy pass completed |  |  |  |
| Performance/basic load considered |  |  |  |
| P0/P1 bugs triaged |  |  |  |

## Phase 9 Release Prep

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| Build/deployment target known |  |  |  |
| Metadata/assets drafted |  |  |  |
| Environment variables known |  |  |  |
| Privacy/terms/support needs handled |  |  |  |
| Account/credential steps isolated |  |  |  |
| Status label accurate |  |  |  |

## Phase 10 Deployment / Upload

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| User approval obtained for production action |  |  |  |
| Deployment/upload command or manual step completed |  |  |  |
| Public URL/artifact/dashboard verified |  |  |  |
| Rollback/recovery known |  |  |  |
| Next user action clear |  |  |  |

## Phase 11 Retrospective

| Criterion | Score | Evidence | Risk |
|---|---:|---|---|
| Decisions recorded |  |  |  |
| Verification evidence recorded |  |  |  |
| Bugs/blockers recorded |  |  |  |
| vNext backlog recorded |  |  |  |
| Memory/project-state/skill separation respected |  |  |  |
