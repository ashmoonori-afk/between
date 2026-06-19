# Birkin Workflow Adaptation Notes for PWSForge

This reference captures the session-specific analysis used to design PWSForge. It should guide future updates without requiring agents to re-read the Birkin repository.

Source repository analyzed: `https://github.com/ashmoonori-afk/birkin`

Key upstream files examined:

- `skills/planning/neurosis/SKILL.md`
- `skills/automation/morpheus/SKILL.md`
- `skills/automation/odyssey/SKILL.md`
- `skills/creative/codex-image-gen/SKILL.md`
- `birkin/neurosis.py`
- `birkin/morpheus.py`
- `birkin/odyssey.py`
- `tests/test_neurosis.py`
- `tests/test_odyssey.py`

## User Requirements Captured

The user requested a real Hermes skill package named **PWSForge** for another Hermes Agent. Its purpose is to teach, guide, help, and execute a linear app-development sequence.

Confirmed requirements:

1. Scope: general-purpose, mobile-app-first, also covering iOS, Android, and Web.
2. Target user: complete non-developer.
3. Tone: mix of tutor, product manager, and coach.
4. PRD depth: startup-level PRD first, then developer handoff PRD.
5. UI design must be decided in the middle before implementation.
6. Execution scope: through actual upload where possible, with approval boundaries.
7. Tech stack: do not hardcode. When the user asks for a stack, web-search current status, explain each stack category's role/purpose, and check/ask install status before using/installing.
8. Default tool posture: use Hermes defaults plus available tools/agents when appropriate.
9. Odyssey meaning: goal-completion cycle.
10. Deliverable target: zip-style transferable package and actual skill.
11. Language: match the user's language.
12. Platforms: iOS, Android, Web.
13. Missing requirements: warn; if user insists, continue with explicit assumptions.
14. Name: PWSForge.

## Neurosis → PWSForge Deep Interview

Original role:

- Socratic deep interview for vague requirements.
- One targeted question per turn.
- Internal ambiguity scoring.
- Topology gate before detailed questioning.
- Challenge modes: contrarian, simplifier, ontologist.
- Produces a pending-approval spec before action.

PWSForge adaptation:

- Use for app idea clarification, purpose, target user, problem, MVP, constraints, success criteria, and launch goals.
- Keep the one-question-at-a-time discipline.
- Hide raw ambiguity math from non-developers; show estimated remaining questions and unresolved items.
- Replace Birkin's fixed Korean-conversation/English-spec rule with user-language matching.
- If the user skips, record assumptions and risks before proceeding.

Recommended app-specific interview axes:

- App purpose.
- Target user.
- User pain/problem.
- First successful user journey.
- MVP and deferred scope.
- Success metrics.
- Platform priority.
- Privacy/payment/AI/map/chat/notification risks.
- Operational model: what the user will manage manually vs. automate.

## Odyssey → PWSForge Goal Completion Cycle

Original role:

- Clarify if vague.
- Plan small verifiable steps.
- Adversarially critique the plan.
- Execute one step at a time.
- Verify with Osiris before checking off.
- Resume from durable Boulder state.

PWSForge adaptation:

- Use as the main engine for the whole app lifecycle.
- Phases become: Intake → Deep Interview → Startup PRD → UI Direction → Handoff PRD → Tech Stack Discovery → Implementation Plan → Build → QA → Release Prep → Upload/Deployment → Learn.
- Require acceptance criteria for each implementation step.
- Use independent verification where possible.
- Do not say an app is complete merely because docs, code, metadata, or builds exist. Distinguish drafted, built, uploaded, submitted, and published.

Important completion language:

- PRD written ≠ app built.
- Code generated ≠ app verified.
- Build created ≠ store uploaded.
- Store uploaded ≠ submitted.
- Submitted ≠ published.

## Morpheus → PWSForge Retrospective / Learning

Original role:

- Nightly unattended self-improvement.
- Review last 24h conversations, changed files, and activity logs.
- Auto-apply reversible memory/skill changes.
- Queue consequential actions for approval.
- Conservative, never destructive.

PWSForge adaptation:

Use two lighter modes instead of assuming unattended nightly automation:

1. **Session Morpheus** after major app-development sessions:
   - What was decided.
   - What PRD/UI/stack/build/release artifacts changed.
   - What failed.
   - What remains.
   - What should be saved as durable preference vs. project state.

2. **Release Morpheus** after build/upload/release milestones:
   - vNext backlog.
   - User feedback themes.
   - QA and crash patterns.
   - Reusable workflows to turn into skills.

Storage rule:

- Durable user preference → memory.
- Project progress/status → project docs/state file.
- Repeatable procedure → skill update.
- Future automation → proposal/checklist, not silent execution.

## Codex Image Gen → PWSForge Visual Asset Support

Original role:

- Generate PNG raster images from text prompts using Codex OAuth / `gpt-image-2` routes such as `god-tibo-imagen`, inherited image MCP, or image generation tools.
- Do not fabricate image success if no route exists.
- Prefer free/OAuth routes but acknowledge unofficial backend risk.

PWSForge adaptation:

Use image generation as supporting capability for:

- UI moodboard.
- App icon concepts.
- Splash screens.
- Onboarding illustrations.
- App Store / Play Store screenshot backgrounds.
- Marketing thumbnails.

Do not let image generation replace UX design. The correct sequence is:

1. App purpose and user context.
2. Brand tone.
3. Screen inventory.
4. User flow and navigation.
5. Design style.
6. Optional visual asset generation.
7. UI implementation.

Hermes-specific route preference:

1. Use Hermes `image_generate` if available.
2. If the user wants Codex/gti, check install/auth status and ask approval.
3. Use image MCP only if available and documented.
4. Paid API routes require explicit user approval.
5. If no route works, provide prompts/design guidance and say image generation is blocked.

## PWSForge Mandatory Gates

### PRD Gate

Warn if missing:

- App purpose.
- Target user.
- Core problem.
- MVP features.
- Success criteria.
- Platform priority.

### UI Gate

Warn if missing:

- App tone/style.
- Core screens.
- Main user flow.
- Navigation model.
- Design reference or style keywords.

### Tech Stack Gate

Warn if missing:

- Frontend/mobile framework.
- Backend/database/auth choice.
- Deployment path.
- External accounts.
- Install readiness.

### Build Gate

Warn if missing:

- Implementation plan.
- Test/build method.
- Acceptance criteria.
- Project path/repository.

### Release Gate

Warn if missing:

- App name.
- Bundle ID / package name.
- Icon.
- Screenshots.
- Privacy policy.
- Terms.
- Store account.
- Build result.
- Review notes.

## Recommended Package Shape

The intended transferable zip-style package should eventually contain:

```text
PWSForge/
  SKILL.md
  references/
    birkin-adaptation.md
    app-development-lifecycle.md
    mobile-release-guide.md
    tech-stack-discovery-guide.md
  templates/
    00-intake-form.md
    01-deep-interview.md
    02-startup-prd.md
    03-handoff-prd.md
    04-ui-direction.md
    05-screen-flow.md
    06-tech-stack-decision.md
    07-implementation-plan.md
    08-qa-checklist.md
    09-release-checklist.md
    10-store-metadata.md
    11-post-launch-review.md
  scripts/
    validate_pwsforge_package.py
```

## Pitfalls to Preserve

- Do not confuse Linear the product with "linear" as a sequential workflow. If the user says "리니어한 스킬 패키지", ask/interpret as sequential unless they explicitly mention Linear issues/projects.
- Do not over-answer with a huge plan when the next step is to gather requirements or create the skill package.
- For PWSForge, UI direction is not optional; it belongs between PRD and implementation.
- For PWSForge, tech stack decisions must be refreshed with current web research when requested.
