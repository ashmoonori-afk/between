import { describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activateBetween } from '../src/extension-core.js'

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
})

function fakeVscode(opts: {
  diagnostics: { clear: () => void; set: (entries: unknown[]) => void; dispose: () => void }
  commands: Map<string, () => Promise<void> | void>
  activeEditor: { document: { uri: { fsPath: string } }; setDecorations: () => void }
  treeProviderUpdates: unknown[]
  showWarningMessage?: (message: string) => void
}) {
  return {
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    Uri: { file: (fsPath: string) => ({ fsPath, toString: () => fsPath }) },
    Range: class {
      constructor(readonly startLine: number) {}
    },
    Diagnostic: class {
      source = ''
      code = ''
      constructor(
        readonly range: unknown,
        readonly message: string,
        readonly severity: number,
      ) {}
    },
    EventEmitter: class {
      event = vi.fn()
      fire(value: unknown) {
        opts.treeProviderUpdates.push(value)
      }
    },
    TreeItem: class {
      label
      collapsibleState
      constructor(label: string, collapsibleState?: number) {
        this.label = label
        this.collapsibleState = collapsibleState
      }
    },
    TreeItemCollapsibleState: { None: 0, Expanded: 1 },
    ThemeIcon: class {
      constructor(readonly id: string) {}
    },
    languages: { createDiagnosticCollection: () => opts.diagnostics },
    window: {
      activeTextEditor: opts.activeEditor,
      createTextEditorDecorationType: () => ({ dispose: vi.fn() }),
      createTreeView: vi.fn(),
      showInformationMessage: vi.fn(),
      showWarningMessage: opts.showWarningMessage ?? vi.fn(),
      showInputBox: vi.fn(async () => 'fix F1'),
      showTextDocument: vi.fn(),
    },
    workspace: {
      workspaceFolders: [{ uri: { fsPath: 'C:\\repo' } }],
      openTextDocument: vi.fn(async () => ({})),
    },
    commands: {
      registerCommand(command: string, fn: () => Promise<void> | void) {
        opts.commands.set(command, fn)
        return { dispose: vi.fn() }
      },
    },
  }
}
