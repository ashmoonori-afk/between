import { describe, it, expect } from 'vitest'
import { render } from 'ink-testing-library'
import { AgentPane } from '../../src/ui/AgentPane'
import { PipeAgentHost } from '../../src/adapters/pipe-agent-host'

describe('AgentPane', () => {
  it('renders the tail of a host output buffer + live status', () => {
    const host = new PipeAgentHost('reviewer', 100)
    host.markStart()
    host.feed('first line\nsecond line\n')
    const { lastFrame } = render(
      <AgentPane
        host={host}
        title="REVIEWER"
        glyph="◎"
        accent="#80F4FF"
        rows={10}
        focusId="reviewer"
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('REVIEWER')
    expect(frame).toContain('first line')
    expect(frame).toContain('second line')
    expect(frame).toContain('live')
  })

  it('shows a placeholder when no host is attached (file mode)', () => {
    const { lastFrame } = render(
      <AgentPane
        host={null}
        title="DEVELOPER"
        glyph="⚒"
        accent="#FFCF99"
        rows={10}
        focusId="developer"
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('DEVELOPER')
    expect(frame).toContain('not hosted')
  })

  it('bounds the rendered tail to `rows`', () => {
    const host = new PipeAgentHost('reviewer', 100)
    for (let i = 0; i < 20; i++) host.feed(`row${i}\n`)
    const { lastFrame } = render(
      <AgentPane
        host={host}
        title="REVIEWER"
        glyph="◎"
        accent="#80F4FF"
        rows={3}
        focusId="reviewer"
      />,
    )
    const frame = lastFrame() ?? ''
    expect(frame).toContain('row19')
    expect(frame).not.toContain('row5')
  })
})
