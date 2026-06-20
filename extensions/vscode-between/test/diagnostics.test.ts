import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BetweenDiagnosticsController, buildBetweenDiagnosticEntries } from '../src/diagnostics.js'

describe('diagnostics', () => {
  it('Problems shows current findings diagnostics', async () => {
    const root = await seedRoot()
    const entries = buildBetweenDiagnosticEntries(fakeVscode, root, currentModel())

    expect(entries).toHaveLength(1)
    expect(entries[0].uri.fsPath).toBe(join(root, 'src', 'app.ts'))
    expect(entries[0].diagnostics.map((diagnostic) => diagnostic.code)).toEqual(['F1', 'F2'])
    expect(entries[0].diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([0, 1])
    expect(entries[0].diagnostics[0].range.start.line).toBe(1)
  })

  it('clears stale diagnostics when findings no longer match the current diff', async () => {
    const root = await seedRoot()
    const collection = new FakeDiagnosticCollection()
    const controller = new BetweenDiagnosticsController(fakeVscode, collection)

    controller.update(root, currentModel())
    expect(collection.count()).toBe(2)

    controller.update(root, staleModel())
    expect(collection.count()).toBe(0)
    expect(collection.clearCalls).toBe(2)
  })

  it('refuses symlink or junction paths that resolve outside the workspace', async () => {
    const root = await seedRoot()
    const outside = await mkdtemp(join(tmpdir(), 'between-vscode-outside-'))
    await writeFile(join(outside, 'app.ts'), 'const secret = true\n')
    await symlink(outside, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')

    const entries = buildBetweenDiagnosticEntries(fakeVscode, root, {
      findings: [
        {
          finding: {
            id: 'F9',
            severity: 'blocking',
            summary: '[linked/app.ts:1] outside through junction',
            target_hash: 'hash-current',
          },
          location: { file: 'linked/app.ts', line: 1 },
          stale: false,
          linked: true,
          hunkIndex: 0,
        },
      ],
    })

    expect(entries).toEqual([])
  })
})

function currentModel() {
  return {
    findings: [
      {
        finding: {
          id: 'F1',
          severity: 'blocking',
          summary: '[src/app.ts:2] missing guard',
          target_hash: 'hash-current',
        },
        location: { file: 'src/app.ts', line: 2 },
        stale: false,
        linked: true,
        hunkIndex: 0,
      },
      {
        finding: {
          id: 'F2',
          severity: 'non-blocking',
          summary: '[src/app.ts:4] rename temp variable',
          target_hash: 'hash-current',
        },
        location: { file: 'src/app.ts', line: 4 },
        stale: false,
        linked: true,
        hunkIndex: 0,
      },
      {
        finding: {
          id: 'F3',
          severity: 'blocking',
          summary: 'unlinked note',
          target_hash: 'hash-current',
        },
        location: null,
        stale: false,
        linked: false,
        hunkIndex: null,
      },
      {
        finding: {
          id: 'F4',
          severity: 'blocking',
          summary: '[../../secret.ts:1] outside workspace',
          target_hash: 'hash-current',
        },
        location: { file: '../../secret.ts', line: 1 },
        stale: false,
        linked: true,
        hunkIndex: 0,
      },
    ],
  }
}

function staleModel() {
  return {
    findings: currentModel().findings.map((finding) => ({
      ...finding,
      stale: true,
      linked: false,
    })),
  }
}

const fakeVscode = {
  DiagnosticSeverity: { Error: 0, Warning: 1 },
  Uri: {
    file(fsPath: string) {
      return { fsPath, toString: () => fsPath }
    },
  },
  Range: class {
    readonly start
    readonly end

    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
      this.start = { line: startLine, character: startCharacter }
      this.end = { line: endLine, character: endCharacter }
    }
  },
  Diagnostic: class {
    readonly range
    readonly message
    readonly severity
    code = ''
    source = ''

    constructor(range: unknown, message: string, severity: number) {
      this.range = range
      this.message = message
      this.severity = severity
    }
  },
}

class FakeDiagnosticCollection {
  readonly values = new Map<string, readonly unknown[]>()
  clearCalls = 0

  clear(): void {
    this.clearCalls += 1
    this.values.clear()
  }

  set(entries: readonly [ReturnType<typeof fakeVscode.Uri.file>, readonly unknown[]][]): void {
    for (const [uri, diagnostics] of entries) {
      this.values.set(uri.fsPath, diagnostics)
    }
  }

  count(): number {
    return [...this.values.values()].reduce((total, diagnostics) => total + diagnostics.length, 0)
  }
}

async function seedRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'between-vscode-root-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'app.ts'), 'const a = 1\nconst b = 2\n')
  return root
}
