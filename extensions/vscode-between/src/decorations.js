import { realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'

export class BetweenDecorationController {
  constructor(vscodeApi) {
    this.vscodeApi = vscodeApi
    this.decoration = vscodeApi.window.createTextEditorDecorationType({
      isWholeLine: true,
      overviewRulerLane: 4,
      light: { backgroundColor: 'rgba(255, 214, 102, 0.16)' },
      dark: { backgroundColor: 'rgba(255, 214, 102, 0.18)' },
    })
  }

  update(editor, workspaceRoot, model) {
    if (!editor) return 0
    const ranges = []
    for (const item of model.findings) {
      if (!isDecoratable(item)) continue
      const target = resolve(workspaceRoot, item.location.file)
      if (!sameFile(editor.document.uri.fsPath, target)) continue
      const line = item.location.line - 1
      ranges.push({
        range: new this.vscodeApi.Range(line, 0, line, 1),
        hoverMessage: item.finding.summary,
      })
    }
    editor.setDecorations(this.decoration, ranges)
    return ranges.length
  }

  clear(editor) {
    editor?.setDecorations(this.decoration, [])
  }

  dispose() {
    this.decoration.dispose()
  }
}

function isDecoratable(item) {
  return item.linked && !item.stale && item.location !== null && item.location.line > 0
}

function sameFile(left, right) {
  const leftPath = safeRealPath(left)
  const rightPath = safeRealPath(right)
  if (!leftPath || !rightPath) return false
  return comparable(leftPath) === comparable(rightPath)
}

function safeRealPath(path) {
  try {
    return realpathSync.native(resolve(path))
  } catch {
    return null
  }
}

function comparable(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path
}
