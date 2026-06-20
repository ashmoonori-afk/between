import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as vscode from 'vscode'
import { BetweenDiagnosticsController } from '../src/diagnostics.js'

suite('Between stale diagnostics smoke', () => {
  test('clears stale diagnostics', async () => {
    const root = await seedRoot()
    const collection = vscode.languages.createDiagnosticCollection('between-smoke-stale')
    const controller = new BetweenDiagnosticsController(vscode, collection)
    const uri = vscode.Uri.file(join(root, 'src', 'app.ts'))
    try {
      assert.equal(controller.update(root, currentModel(false)), 1)
      assert.equal(collection.get(uri)?.length, 1)
      assert.equal(controller.update(root, currentModel(true)), 0)
      assert.equal(collection.get(uri)?.length ?? 0, 0)
    } finally {
      collection.dispose()
    }
  })
})

function currentModel(stale) {
  return {
    findings: [
      {
        finding: {
          id: 'F1',
          severity: 'blocking',
          summary: '[src/app.ts:2] missing guard',
          target_hash: stale ? 'old-hash' : 'hash-current',
        },
        location: { file: 'src/app.ts', line: 2 },
        stale,
        linked: !stale,
        hunkIndex: stale ? null : 0,
      },
    ],
  }
}

async function seedRoot() {
  const root = await mkdtemp(join(tmpdir(), 'between-vscode-smoke-'))
  await mkdir(join(root, 'src'), { recursive: true })
  await writeFile(join(root, 'src', 'app.ts'), 'const a = 1\n')
  return root
}
