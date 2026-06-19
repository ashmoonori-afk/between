# PWSForge 전체 설계 문서

## 1. 목적

PWSForge는 완전 비개발자 사용자가 모바일앱을 우선으로 앱을 만들고 출시할 수 있도록 돕는 리니어 앱 개발 스킬 패키지입니다.

범위는 다음 전체 생명주기를 포함합니다.

1. 앱 아이디어 deep interview
2. 스타트업용 PRD 작성
3. 개발 핸드오프 PRD 작성
4. UI 디자인 방향 결정
5. 기술스택 조사와 설치/사용 확인
6. 구현 계획 수립
7. 단계별 개발 실행
8. QA와 빌드 검증
9. iOS / Android / Web 출시 준비
10. 앱 업로드 및 제출 보조
11. 출시 후 회고와 다음 버전 계획

PWSForge는 단순히 앱 개발 방법을 설명하는 스킬이 아니라, 사용자를 튜터·프로덕트 매니저·코치처럼 이끌며 실제 실행과 검증까지 돕는 것을 목표로 합니다.

## 2. 대상 사용자

기본 대상은 완전 비개발자입니다.

따라서 PWSForge는 다음 원칙을 따릅니다.

- 전문용어를 먼저 쓰지 않습니다.
- 기술 선택 전 각 기술의 역할과 목적을 설명합니다.
- 사용자가 결정해야 하는 항목을 쉬운 선택지로 제시합니다.
- 앱 개발 순서를 건너뛰지 않습니다.
- 확인되지 않은 내용을 가정으로 처리할 때는 assumptions를 명확히 기록합니다.

## 3. 발화 Hook

PWSForge의 기본 발화 hook은 다음입니다.

```text
letsbuild
```

사용자가 `letsbuild`라고 말하면 Hermes Agent는 PWSForge 전체 플로우를 시작해야 합니다.

동의어/보조 트리거:

- `let's build`
- `앱 만들자`
- `앱 개발 시작하자`
- `PWSForge 시작`
- `앱을 처음부터 출시까지 만들어줘`

시작 응답 예시:

```text
[PWSForge] letsbuild 확인했습니다. 아이디어를 바로 개발하지 않고, 먼저 앱 목적과 사용자 문제를 명확히 한 뒤 PRD, UI 방향, 기술스택, 구현, QA, 출시 순서로 진행하겠습니다.
```

## 4. Birkin 스킬 분석 및 PWSForge 흡수 설계

분석 기준 저장소:

<https://github.com/ashmoonori-afk/birkin>

확인한 주요 파일:

- `skills/planning/neurosis/SKILL.md`
- `skills/automation/morpheus/SKILL.md`
- `skills/automation/odyssey/SKILL.md`
- `skills/creative/codex-image-gen/SKILL.md`
- `birkin/neurosis.py`
- `birkin/morpheus.py`
- `birkin/odyssey.py`
- `tests/test_neurosis.py`
- `tests/test_odyssey.py`

### 4.1 Neurosis → Deep Interview Engine

원본 Neurosis는 Socratic deep interview 시스템입니다.

핵심 특징:

- 한 번에 질문 하나만 합니다.
- 모호한 요구를 바로 실행하지 않습니다.
- Goal, Constraints, Success Criteria, Context를 기준으로 명확도를 판단합니다.
- ambiguity가 충분히 낮아질 때까지 질문합니다.
- 최종 spec을 만들고 승인 전까지 실행하지 않습니다.

PWSForge에서의 역할:

- 앱 목적을 명확히 합니다.
- 타깃 사용자와 핵심 문제를 정의합니다.
- MVP 범위를 정합니다.
- PRD 작성 전 핵심 assumptions를 드러냅니다.
- 비개발자가 놓치기 쉬운 제약을 질문합니다.

PWSForge용 질문 축:

- 이 앱은 누구의 어떤 문제를 해결하나요?
- 사용자가 앱에서 가장 먼저 성공해야 하는 행동은 무엇인가요?
- MVP에서 반드시 필요한 기능은 무엇인가요?
- 나중으로 미뤄도 되는 기능은 무엇인가요?
- iOS, Android, Web 중 무엇을 먼저 출시해야 하나요?
- 성공 여부를 어떤 지표로 판단하나요?
- 로그인, 결제, 알림, 위치, AI, 커뮤니티, 채팅 등 고위험 기능이 필요한가요?

PWSForge 적용 변경점:

- 원본의 “대화는 한국어, spec은 영어” 규칙은 제거합니다.
- 모든 대화와 문서는 사용자 언어를 기본으로 합니다.
- 내부 점수나 threshold는 사용자에게 노출하지 않습니다.
- 사용자에게는 “예상 남은 질문”과 “확정되지 않은 항목”만 보여줍니다.

### 4.2 Odyssey → Goal Completion Cycle

원본 Odyssey는 복잡한 목표를 끝까지 완료하기 위한 goal-completion cycle입니다.

핵심 사이클:

1. 목표가 모호하면 Neurosis로 명확화합니다.
2. 작은 검증 가능한 단계로 계획합니다.
3. Hyperplan 방식으로 계획을 비판합니다.
4. 한 단계씩 실행합니다.
5. Osiris 방식으로 각 단계를 독립 검증합니다.
6. 전체 목표가 검증될 때까지 반복합니다.

PWSForge에서의 역할:

- 전체 앱 개발 플로우의 메인 실행 엔진입니다.
- PRD, UI, 기술스택, 개발, QA, 출시를 순서대로 밀고 갑니다.
- 각 단계는 acceptance criteria를 가져야 합니다.
- 검증되지 않은 상태를 완료라고 말하지 않습니다.

PWSForge에서의 적용:

- Boulder 개념 → `docs/pwsforge/state.json` 또는 단계별 체크리스트
- Hyperplan 개념 → 구현 전 계획 비판
- Osiris 개념 → 각 단계별 독립 검증
- Resume-safe 개념 → 중단 후 이어갈 수 있는 문서/상태 파일 유지

### 4.3 Morpheus → Project Learning & Retrospective Engine

원본 Morpheus는 최근 24시간의 대화와 변경 파일을 검토해 메모리와 스킬을 개선하는 야간 self-improvement 시스템입니다.

핵심 특징:

- 최근 대화 분석
- 변경 파일 분석
- 활동 로그 분석
- durable knowledge 저장
- 반복 절차를 skill로 생성/개선
- consequential action은 직접 실행하지 않고 제안만 함

PWSForge에서의 역할:

- 각 주요 마일스톤 후 회고를 수행합니다.
- 앱 개발 중 결정사항을 정리합니다.
- 다음 버전 backlog를 만듭니다.
- 반복 가능한 개발 절차를 skill 후보로 분리합니다.
- durable memory와 project state를 구분합니다.

저장 분리 원칙:

- 장기 사용자 선호 → memory
- 현재 프로젝트 진행상황 → project docs/state file
- 반복 가능한 절차 → skill
- 향후 자동화 아이디어 → proposal/checklist

### 4.4 Codex Image Gen → Visual Asset Support Engine

원본 Codex Image Gen은 Codex OAuth 또는 이미지 생성 경로를 활용해 PNG 이미지를 생성하는 스킬입니다.

핵심 특징:

- 실제 PNG 파일 생성
- 이미지 생성 경로가 없으면 성공했다고 말하지 않음
- API key 없는 경로를 우선 고려
- 실패 시 정확한 원인 보고

PWSForge에서의 역할:

- UI 무드보드 생성
- 앱 아이콘 컨셉 생성
- 스플래시 이미지 생성
- 온보딩 일러스트 생성
- 앱스토어/플레이스토어 스크린샷 배경 생성
- 마케팅 썸네일 생성

중요 원칙:

이미지 생성은 UI 디자인의 본체가 아니라 보조 수단입니다.

PWSForge UI 설계 순서:

1. 앱 목적과 사용자 상황 확인
2. 브랜드 톤 결정
3. 핵심 화면 목록 작성
4. 화면별 정보구조 정의
5. 내비게이션 구조 결정
6. 디자인 스타일 결정
7. 필요 시 레퍼런스/무드보드 생성
8. 아이콘/스플래시/스토어 이미지 생성
9. 실제 앱 UI 컴포넌트 구현

## 5. PWSForge 리니어 생명주기

### Phase 0. Intake

목표:

- 앱 아이디어 수집
- 플랫폼 우선순위 확인
- 기존 프로젝트 여부 확인
- 사용자의 기술 이해도 확인

산출물:

- `00-intake.md`

### Phase 1. Deep Interview

목표:

- 앱 목적, 사용자, 문제, 성공 기준 명확화
- MVP 범위 도출
- assumptions와 리스크 확인

산출물:

- `01-deep-interview.md`

### Phase 2. Startup PRD

목표:

- 스타트업 수준의 PRD 작성
- 비개발자가 이해할 수 있는 제품 정의 문서 생성

포함 항목:

- 앱 컨셉
- 문제 정의
- 타깃 사용자
- 핵심 가치
- MVP 기능
- Non-goals
- 성공 지표
- 리스크

산출물:

- `02-startup-prd.md`

### Phase 3. UI Direction Decision

목표:

- 개발 전 UI 방향을 반드시 결정
- 화면 목록과 사용자 흐름 확정

포함 항목:

- 브랜드 톤
- 비주얼 스타일
- 내비게이션 구조
- 핵심 화면
- 빈 상태, 로딩 상태, 에러 상태
- 디자인 레퍼런스 또는 스타일 키워드

산출물:

- `03-ui-direction.md`
- `04-screen-flow.md`

### Phase 4. Handoff PRD

목표:

- 개발자가 바로 구현 가능한 수준으로 PRD 확장

포함 항목:

- 기능별 요구사항
- 화면별 요구사항
- 유저 플로우
- 데이터 모델
- API 요구사항
- 인증/결제/알림/관리자 기능
- acceptance criteria

산출물:

- `05-handoff-prd.md`

### Phase 5. Tech Stack Discovery

목표:

- 고정 기술스택을 강제하지 않고 현재 기준으로 조사
- 각 스택의 역할과 목적을 설명
- 설치/사용 여부를 사용자에게 확인

필수 규칙:

- 사용자가 요구한 기술은 web search로 최신 상태를 확인합니다.
- 설치 여부는 가능한 경우 실제 환경에서 확인합니다.
- 설치 또는 계정 연동은 승인 후 진행합니다.

산출물:

- `06-tech-stack-decision.md`

### Phase 6. Implementation Plan

목표:

- 구현을 작은 검증 가능한 작업으로 분해
- 각 작업에 acceptance criteria 부여

산출물:

- `07-implementation-plan.md`

### Phase 7. Build

목표:

- 한 단계씩 개발하고 검증
- 실패 시 루프를 돌지 않고 blocker를 보고

진행 표시 예:

```text
[PWSForge: Build] step 3/12 | 로그인 화면 구현 | 예상 남은 단계: ~9
```

### Phase 8. QA

목표:

- 코드뿐 아니라 실제 앱 경험을 검증

검증 항목:

- 핵심 유저 플로우
- 로그인/로그아웃
- 결제/구독, 해당 시
- 권한 요청
- 빈 상태/로딩/에러 상태
- 모바일 화면 크기
- 접근성 기본
- 개인정보 처리

산출물:

- `08-qa-checklist.md`

### Phase 9. Release Prep

목표:

- iOS, Android, Web 출시 준비물 작성

포함 항목:

- 앱 이름
- bundle ID / package name
- 앱 아이콘
- 스플래시
- 스크린샷
- 스토어 설명
- 개인정보처리방침
- 약관
- 심사 메모
- 빌드/버전 번호

산출물:

- `09-release-checklist.md`
- `10-store-metadata.md`

### Phase 10. Upload / Launch Support

목표:

- 가능한 범위에서 실제 업로드를 돕되, 승인 경계를 지킴

상태 표현:

- Drafted: 메타데이터/자료 작성 완료
- Built: 빌드 완료
- Uploaded: 스토어/호스팅에 업로드 완료
- Submitted: 심사 제출 완료
- Published: 실제 공개 완료

승인 필요:

- 스토어 계정 로그인
- 2FA
- 유료 서비스 사용
- production 리소스 변경
- 실제 심사 제출

### Phase 11. Learn / Retrospective

목표:

- 이번 개발에서 배운 것 정리
- 다음 버전 backlog 생성
- 재사용 가능한 절차를 skill 후보로 분리

산출물:

- `11-post-launch-review.md`

## 6. 필수 Gate

### PRD Gate

누락 시 경고:

- 앱 목적
- 타깃 사용자
- 핵심 문제
- MVP 기능
- 성공 기준
- 플랫폼 우선순위

### UI Gate

누락 시 경고:

- 비주얼 톤
- 메인 화면 목록
- 메인 유저 플로우
- 내비게이션 방식
- 스타일 레퍼런스 또는 키워드

### Tech Stack Gate

누락 시 경고:

- 모바일 프레임워크
- 백엔드/DB/Auth 계획
- 배포 계획
- 필요한 계정
- 설치 상태

### Build Gate

누락 시 경고:

- 구현 계획
- 테스트 명령
- acceptance criteria
- 프로젝트 경로/저장소

### Release Gate

누락 시 경고:

- 앱 이름
- bundle ID / package name
- 아이콘
- 스크린샷
- 개인정보처리방침
- 약관
- 스토어 계정 준비 상태
- 성공한 빌드

## 7. Assumptions 처리 규칙

필수 항목이 없으면 먼저 경고합니다.

사용자가 강행하면 다음 형식으로 기록합니다.

```text
[PWSForge: Gate]
필수 항목 일부가 아직 확정되지 않았습니다. 사용자가 강행을 요청했으므로 다음 assumptions를 두고 진행합니다.

Assumptions:
- ...

Risks:
- ...

나중에 확정해야 할 항목:
- ...
```

## 8. 기술스택 원칙

PWSForge는 기본 기술스택을 강제하지 않습니다.

대신 다음 과정을 따릅니다.

1. 사용자가 원하는 기술 또는 프로젝트 요구를 확인합니다.
2. 필요한 기술 카테고리를 설명합니다.
3. 현재 웹 검색으로 최신 상태와 설치 문서를 확인합니다.
4. 가능한 경우 설치 여부를 확인합니다.
5. 설치/사용 전 사용자 승인을 받습니다.
6. 선택 이유와 tradeoff를 문서화합니다.

## 9. 업로드 자동화 기본값

기본 정책:

- 앱스토어/플레이스토어 메타데이터 작성: 자동 수행 가능
- 빌드 명령 실행: 사용자 승인 후 수행
- 스토어 로그인/계정 접근: 사용자 직접 로그인 또는 명시 승인 필요
- 실제 제출 버튼/심사 제출: 반드시 사용자 최종 확인 후 수행
- 자동 제출: 기본 금지, 사용자가 명시적으로 요청할 때만 허용

## 10. Forge Master 전문화 설계

PWSForge는 이제 단순한 리니어 코치가 아니라, 다른 Hermes 스킬과 subagent를 조율하는 대장간 역할을 포함합니다.

핵심 변경점:

1. 메인 PWSForge는 제품 맥락, 사용자 설명, 승인 경계, 산출물 일관성, 최종 검증을 책임집니다.
2. 전문 스킬은 특정 영역의 작업자 또는 리뷰어로 사용합니다.
3. 예측 가능한 작업은 순차 workflow로 처리하고, 복잡한 구현/리서치/검증은 routing, parallelization, orchestrator-workers, evaluator-optimizer 패턴을 선택적으로 사용합니다.
4. 다른 스킬이나 subagent를 부를 때는 반드시 task brief를 작성합니다.
5. subagent 결과는 자기 보고만 믿지 않고 파일, diff, 테스트, 빌드, URL, 스크린샷 등으로 검증합니다.
6. 프로젝트 상태는 `docs/pwsforge/state.json`과 단계별 문서에 저장해 다른 Hermes 컴퓨터에서도 이어받을 수 있게 합니다.

전문 산출물 구조:

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

스킬 라우팅 예:

| 상황 | 호출 후보 |
|---|---|
| 구현 계획 | `writing-plans`, `subagent-driven-development` |
| 기능 구현/TDD | `test-driven-development` |
| 버그/실패 테스트 | `systematic-debugging` |
| 기존 코드 분석 | `codebase-inspection` |
| 코드 리뷰 | `requesting-code-review`, `github-code-review` |
| GitHub PR/릴리즈 | `github-pr-workflow` |
| 외부 코딩 에이전트 | `claude-code`, `codex`, `opencode` |
| UI 탐색 | `sketch`, `popular-web-designs`, `claude-design` |

세부 운영 기준은 `references/forge-orchestration.md`에 둡니다.

## 11. 권장 패키지 구조

최종 zip 패키지는 다음 구조를 권장합니다.

```text
PWSForge/
  SKILL.md
  references/
    pwsforge-design.md
    birkin-adaptation.md
    forge-orchestration.md
    phase-playbook.md
    app-development-lifecycle.md
    mobile-release-guide.md
    web-release-guide.md
    tech-stack-discovery-guide.md
  templates/
    task-brief.md
    architecture-decision.md
    phase-gate-scorecard.md
    state.schema.json
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
  assets/
    README.md
```

현재 Hermes skill 위치에서는 이 문서가 다음 경로에 저장됩니다.

```text
C:/Users/lg/AppData/Local/hermes/skills/software-development/pwsforge/references/pwsforge-design.md
```
