import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { BetweenDiagnosticsController, buildBetweenDiagnosticEntries } from '../src/diagnostics.js'

suite('Between diagnostics smoke', () => {
  test('Problems shows current findings diagnostics count', async () => {
    const root = await seedRoot()
    const collection = vscode.languages.createDiagnosticCollection('between-smoke-count')
    const controller = new BetweenDiagnosticsController(vscode, collection)
    try {
      const count = controller.update(root, currentModel())
      const diagnostics = collection.get(vscode.Uri.file(join(root, 'src', 'app.ts')))
      assert.equal(count, 2)
      assert.equal(diagnostics?.length, 2)
    } finally {
      collection.dispose()
    }
  })

  test('Problems shows current findings severity mapping', async () => {
    const root = await seedRoot()
    const entries = buildBetweenDiagnosticEntries(vscode, root, currentModel())
    assert.equal(entries.length, 1)
    assert.deepEqual(
      entries[0].diagnostics.map((diagnostic) => diagnostic.severity),
      [vscode.DiagnosticSeverity.Error, vscode.DiagnosticSeverity.Warning],
    )
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
    ],
  }
}

async function seedRoot() {
  const root = await mkdtemp(join(tmpdir(), 'between-vscode-smoke-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'app.ts'), 'const a = 1\nconst b = 2\n')
  return root
}
