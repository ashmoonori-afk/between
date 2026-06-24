import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activateBetween } from '../src/extension-core.js'
import { fakeVscode } from './fake-vscode'

describe('extension runtime wiring', () => {
  it('refresh reads workspace data, updates Problems, decorations, and tree view', async () => {
    const root = await mkdtemp(join(tmpdir(), 'between-extension-runtime-'))
    await writeFile(join(root, 'app.ts'), 'const value = 1\n')
    const diagnostics = { clear: vi.fn(), set: vi.fn(), dispose: vi.fn() }
    const treeProviderUpdates: unknown[] = []
    const commands = new Map<string, () => Promise<void> | void>()
    const activeEditor = {
      document: { uri: { fsPath: join(root, 'app.ts') } },
      setDecorations: vi.fn(),
    }
    await mkdir(root, { recursive: true })
    const vscode = fakeVscode({
      diagnostics,
      commands,
      activeEditor,
      treeProviderUpdates,
    })
    const context = { subscriptions: [] as unknown[] }
    const view = {
      project: 'demo',
      phase: 'human_gate',
      cycle: 1,
      bundleId: 'bundle',
      evidenceVerdict: 'blocked',
      canApprove: true,
      model: {
        findings: [
          {
            finding: { id: 'F1', severity: 'blocking', summary: '[app.ts:1] bug' },
            location: { file: 'app.ts', line: 1 },
            linked: true,
            stale: false,
          },
        ],
      },
    }

    activateBetween(context, vscode, {
      workspaceRoot: () => root,
      readWorkspace: async () => view,
      submitAction: async () => {},
      evidenceMarkdown: () => '# Evidence\n',
    })

    await commands.get('between.refresh')?.()

    expect(diagnostics.clear).toHaveBeenCalled()
    expect(diagnostics.set).toHaveBeenCalled()
    expect(activeEditor.setDecorations).toHaveBeenCalled()
    expect(treeProviderUpdates.at(-1)).toBe(view)
  })

  it('refuses exact bundle approval when the refreshed workspace is not approvable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'between-extension-approval-'))
    const diagnostics = { clear: vi.fn(), set: vi.fn(), dispose: vi.fn() }
    const commands = new Map<string, () => Promise<void> | void>()
    const warning = vi.fn()
    const submitAction = vi.fn()
    const vscode = fakeVscode({
      diagnostics,
      commands,
      activeEditor: {
        document: { uri: { fsPath: join(root, 'app.ts') } },
        setDecorations: vi.fn(),
      },
      treeProviderUpdates: [],
      showWarningMessage: warning,
    })
    const context = { subscriptions: [] as unknown[] }

    activateBetween(context, vscode, {
      workspaceRoot: () => root,
      readWorkspace: async () => ({
        project: 'demo',
        phase: 'human_gate',
        cycle: 1,
        bundleId: 'bundle',
        evidenceVerdict: 'simulated',
        canApprove: false,
        model: { findings: [] },
      }),
      submitAction,
      evidenceMarkdown: () => '# Evidence\n',
    })

    await commands.get('between.approveExactBundle')?.()

    expect(submitAction).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith('Between exact bundle approval requires real evidence.')
  })

  it('opens the broker-only IDE webview and routes input through the broker action', async () => {
    const root = await mkdtemp(join(tmpdir(), 'between-extension-ide-'))
    const diagnostics = { clear: vi.fn(), set: vi.fn(), dispose: vi.fn() }
    const commands = new Map<string, () => Promise<void> | void>()
    const webviewHandlers: Array<(message: unknown) => Promise<void> | void> = []
    const panel = {
      reveal: vi.fn(),
      dispose: vi.fn(),
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      webview: {
        html: '',
        onDidReceiveMessage: vi.fn((handler: (message: unknown) => Promise<void> | void) => {
          webviewHandlers.push(handler)
          return { dispose: vi.fn() }
        }),
      },
    }
    const submitAction = vi.fn(async () => {})
    const vscode = fakeVscode({
      diagnostics,
      commands,
      activeEditor: {
        document: { uri: { fsPath: join(root, 'app.ts') } },
        setDecorations: vi.fn(),
      },
      treeProviderUpdates: [],
      webviewPanel: panel,
    })
    const context = { subscriptions: [] as unknown[] }

    activateBetween(context, vscode, {
      workspaceRoot: () => root,
      readWorkspace: async () => ({
        project: 'demo',
        phase: 'human_gate',
        cycle: 2,
        cyclesThisGoal: 1,
        bundleId: 'bundle',
        diffHash: 'diff',
        evidenceVerdict: 'blocked',
        evidenceTrust: 'real',
        canApprove: false,
        developer: 'claude',
        developerStatus: 'working',
        reviewer: 'codex',
        reviewerStatus: 'idle',
        waitingOn: 'human',
        changedFiles: 1,
        model: { findings: [] },
      }),
      submitAction,
      evidenceMarkdown: () => '# Evidence\n',
    })

    await commands.get('between.openIde')?.()
    await webviewHandlers[0]?.({ type: 'brokerInput', message: 'keep broker-only' })
    await webviewHandlers[0]?.({
      type: 'configureTopology',
      builderAgentCount: 4,
      reviewerAgentCount: 2,
      permissionMode: 'guard',
      workingFolder: 'packages/app',
      followupMode: 'queue',
    })

    expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith('between.ide', 'Between IDE', 1, {
      enableScripts: true,
      retainContextWhenHidden: true,
    })
    expect(panel.webview.html).toContain('data-between-ide')
    expect(submitAction).toHaveBeenCalledWith(root, {
      kind: 'broker_input',
      message: 'keep broker-only',
    })
    expect(submitAction).toHaveBeenCalledWith(root, {
      kind: 'configure_topology',
      builderAgentCount: 4,
      reviewerAgentCount: 2,
      permissionMode: 'guard',
      workingFolder: 'packages/app',
      followupMode: 'queue',
    })
  })

  it('surfaces IDE topology action failures through VS Code warnings', async () => {
    const root = await mkdtemp(join(tmpdir(), 'between-extension-ide-warning-'))
    const diagnostics = { clear: vi.fn(), set: vi.fn(), dispose: vi.fn() }
    const commands = new Map<string, () => Promise<void> | void>()
    const warning = vi.fn()
    const webviewHandlers: Array<(message: unknown) => Promise<void> | void> = []
    const panel = {
      reveal: vi.fn(),
      dispose: vi.fn(),
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      webview: {
        html: '',
        onDidReceiveMessage: vi.fn((handler: (message: unknown) => Promise<void> | void) => {
          webviewHandlers.push(handler)
          return { dispose: vi.fn() }
        }),
      },
    }
    const submitAction = vi.fn(async () => {
      throw new Error('builderAgentCount must be an integer from 1 to 16')
    })
    const vscode = fakeVscode({
      diagnostics,
      commands,
      activeEditor: {
        document: { uri: { fsPath: join(root, 'app.ts') } },
        setDecorations: vi.fn(),
      },
      treeProviderUpdates: [],
      showWarningMessage: warning,
      webviewPanel: panel,
    })
    const context = { subscriptions: [] as unknown[] }

    activateBetween(context, vscode, {
      workspaceRoot: () => root,
      readWorkspace: async () => ({
        project: 'demo',
        phase: 'human_gate',
        cycle: 2,
        evidenceVerdict: 'blocked',
        canApprove: false,
        model: { findings: [] },
      }),
      submitAction,
      evidenceMarkdown: () => '# Evidence\n',
    })

    await commands.get('between.openIde')?.()
    await webviewHandlers[0]?.({
      type: 'configureTopology',
      builderAgentCount: 0,
      reviewerAgentCount: 2,
    })

    expect(warning).toHaveBeenCalledWith(
      'Between IDE action failed: builderAgentCount must be an integer from 1 to 16',
    )
  })
})
