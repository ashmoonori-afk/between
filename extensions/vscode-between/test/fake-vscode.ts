import { vi } from 'vitest'

interface FakeVscodeOptions {
  diagnostics: { clear: () => void; set: (entries: unknown[]) => void; dispose: () => void }
  commands: Map<string, () => Promise<void> | void>
  activeEditor: { document: { uri: { fsPath: string } }; setDecorations: () => void }
  treeProviderUpdates: unknown[]
  showWarningMessage?: (message: string) => void
  webviewPanel?: unknown
}

export function fakeVscode(opts: FakeVscodeOptions) {
  const webviewPanel =
    opts.webviewPanel ??
    ({
      reveal: vi.fn(),
      dispose: vi.fn(),
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      webview: { html: '', onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })) },
    } as unknown)
  return {
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    ViewColumn: { One: 1 },
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
      createWebviewPanel: vi.fn(() => webviewPanel),
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
