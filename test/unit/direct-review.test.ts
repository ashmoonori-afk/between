import { describe, expect, it } from 'vitest'
import {
  RUBRICS,
  buildReviewPrompt,
  fakeReviewerOutput,
  FAKE_REQUEST_CHANGES_MARKER,
  hostFromClientName,
  parseReviewerOutput,
  presetFromCommand,
  resolveReviewer,
  reviewerInvocation,
  ReviewerOutputError,
} from '../../src/review/direct'
import { reviewShim } from '../../src/review/shims'

const reply = (body: unknown, prose = 'Here is my review.') =>
  `${prose}\n\`\`\`json\n${JSON.stringify(body)}\n\`\`\`\n`

describe('parseReviewerOutput', () => {
  it('reads the last valid fenced JSON block and numbers the findings', () => {
    const raw =
      reply({ note: 'draft, not a review' }) +
      reply({
        summary: 'Mostly fine',
        verdict: 'APPROVE',
        findings: [{ severity: 'minor', title: 'typo', detail: 'x', location: null }],
        questions: ['why?', '  '],
      })
    const parsed = parseReviewerOutput(raw)
    expect(parsed).toEqual({
      summary: 'Mostly fine',
      verdict: 'APPROVE',
      verdict_adjusted: false,
      findings: [{ id: 'F1', severity: 'minor', title: 'typo', detail: 'x' }],
      questions: ['why?'],
    })
  })

  it('falls back to a bare JSON object in prose', () => {
    const raw = 'Verdict follows {"summary":"ok","verdict":"APPROVE"} done'
    expect(parseReviewerOutput(raw)).toMatchObject({ verdict: 'APPROVE', findings: [] })
  })

  it('forces REQUEST_CHANGES when a critical or major finding exists', () => {
    const parsed = parseReviewerOutput(
      reply({
        summary: 'Approve anyway',
        verdict: 'APPROVE',
        findings: [{ severity: 'major', title: 'missing rollback', criterion: 'risks' }],
      }),
    )
    expect(parsed.verdict).toBe('REQUEST_CHANGES')
    expect(parsed.verdict_adjusted).toBe(true)
    expect(parsed.findings[0]).toMatchObject({ id: 'F1', criterion: 'risks', detail: '' })
  })

  it('rejects replies without a valid verdict object', () => {
    expect(() => parseReviewerOutput('looks good to me')).toThrow(ReviewerOutputError)
    expect(() =>
      parseReviewerOutput(reply({ summary: 'x', verdict: 'LGTM', findings: [] })),
    ).toThrow(ReviewerOutputError)
  })
})

describe('buildReviewPrompt', () => {
  it.each(['diff', 'answer', 'plan'] as const)(
    'carries the %s rubric and fences the subject',
    (kind) => {
      const prompt = buildReviewPrompt({
        kind,
        subject: 'SUBJECT BODY',
        subjectLabel: 'inline text',
        context: 'the question',
        focus: 'error handling',
        criteria: ['mentions cost'],
        boundary: 'BETWEEN-abc',
      })
      for (const c of RUBRICS[kind]) expect(prompt).toContain(`- ${c.name}: `)
      expect(prompt).toContain('Focus: error handling')
      expect(prompt).toContain('- mentions cost')
      expect(prompt).toContain('<<<BETWEEN-abc subject\nSUBJECT BODY\nBETWEEN-abc>>>')
      expect(prompt).toContain('<<<BETWEEN-abc context\nthe question\nBETWEEN-abc>>>')
    },
  )

  it('uses the English rubrics the brief names for answers and plans', () => {
    expect(RUBRICS.answer.map((c) => c.name)).toEqual([
      'correctness',
      'completeness',
      'evidence',
      'clarity',
    ])
    expect(RUBRICS.plan.map((c) => c.name)).toEqual([
      'goals',
      'scope',
      'risks',
      'sequencing',
      'testability',
      'open decisions',
    ])
  })
})

describe('reviewer routing', () => {
  it('prefers explicit, then the other agent of the caller, then config', () => {
    expect(resolveReviewer({ reviewer: 'claude', from: 'claude' })).toEqual({
      preset: 'claude',
      routed_by: 'explicit',
    })
    expect(resolveReviewer({ from: 'claude', reviewerCommand: 'claude' })).toEqual({
      preset: 'codex',
      routed_by: 'paired_with_caller',
    })
    expect(resolveReviewer({ from: 'codex' })?.preset).toBe('claude')
    expect(
      resolveReviewer({ reviewerCommand: 'node .between/agents/codex-agent.mjs reviewer' }),
    ).toEqual({ preset: 'codex', routed_by: 'config' })
  })

  it('never picks a configured fake reviewer implicitly', () => {
    expect(
      resolveReviewer({ reviewerCommand: 'node .between/agents/fake-agent.mjs reviewer' }),
    ).toBeNull()
    expect(resolveReviewer({})).toBeNull()
  })

  it('infers presets from commands and hosts from MCP client names', () => {
    expect(presetFromCommand('claude')).toBe('claude')
    expect(presetFromCommand('/usr/local/bin/codex')).toBe('codex')
    expect(presetFromCommand('my-reviewer')).toBeNull()
    expect(hostFromClientName('claude-code')).toBe('claude')
    expect(hostFromClientName('codex-mcp-client')).toBe('codex')
    expect(hostFromClientName('cursor')).toBeUndefined()
  })

  it('invokes codex read-only and non-interactive', () => {
    const { file, args } = reviewerInvocation('codex', '/tmp/w')
    expect(file).toBe('codex')
    expect(args.slice(0, 3)).toEqual(['--ask-for-approval', 'never', 'exec'])
    expect(args.join(' ')).toContain(
      '--sandbox read-only --cd /tmp/w --ignore-user-config --ignore-rules -c mcp_servers={}',
    )
    for (const feature of ['shell_tool', 'unified_exec', 'view_image', 'hooks']) {
      expect(args[args.indexOf(feature) - 1], feature).toBe('--disable')
    }
    expect(reviewerInvocation('claude', '/tmp/w')).toEqual({
      file: 'claude',
      args: ['-p', '--output-format', 'text', '--tools', '', '--strict-mcp-config'],
    })
  })
})

describe('fake reviewer', () => {
  it('speaks the reviewer wire format for both verdicts', () => {
    expect(parseReviewerOutput(fakeReviewerOutput('plain')).verdict).toBe('APPROVE')
    const changes = parseReviewerOutput(fakeReviewerOutput(`x ${FAKE_REQUEST_CHANGES_MARKER}`))
    expect(changes.verdict).toBe('REQUEST_CHANGES')
    expect(changes.findings).toHaveLength(1)
  })
})

describe('review shims', () => {
  it.each(['claude', 'codex'] as const)(
    'routes %s through between_review with its own from',
    (host) => {
      const shim = reviewShim(host)
      expect(shim).toContain('between_review')
      expect(shim).toContain(`from: "${host}"`)
      expect(shim).toContain(`--from ${host}`)
      expect(shim).toContain('$ARGUMENTS')
      expect(shim.startsWith('---\ndescription: ')).toBe(true)
    },
  )
})
