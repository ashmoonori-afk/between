import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

const SOURCE = 'between'

export class BetweenDiagnosticsController {
  constructor(vscodeApi, collection) {
    this.vscodeApi = vscodeApi
    this.collection = collection
  }

  update(workspaceRoot, model) {
    this.collection.clear()
    const entries = buildBetweenDiagnosticEntries(this.vscodeApi, workspaceRoot, model)
    if (entries.length > 0) {
      this.collection.set(entries.map((entry) => [entry.uri, entry.diagnostics]))
    }
    return entries.reduce((total, entry) => total + entry.diagnostics.length, 0)
  }

  clear() {
    this.collection.clear()
  }
}

export function buildBetweenDiagnosticEntries(vscodeApi, workspaceRoot, model) {
  const byUri = new Map()
  for (const item of model.findings) {
    if (!shouldShowFinding(item)) continue
    const filePath = resolveInsideWorkspace(workspaceRoot, item.location.file)
    if (filePath === null) continue

    const uri = vscodeApi.Uri.file(filePath)
    const key = uri.toString()
    const diagnostic = toDiagnostic(vscodeApi, item)
    const existing = byUri.get(key)
    if (existing) {
      existing.diagnostics.push(diagnostic)
    } else {
      byUri.set(key, { uri, diagnostics: [diagnostic] })
    }
  }
  return [...byUri.values()].sort((a, b) => a.uri.fsPath.localeCompare(b.uri.fsPath))
}

function shouldShowFinding(item) {
  return (
    item.linked &&
    !item.stale &&
    item.location !== null &&
    typeof item.location.file === 'string' &&
    Number.isFinite(item.location.line) &&
    item.location.line > 0
  )
}

function resolveInsideWorkspace(workspaceRoot, file) {
  let root
  let candidate
  try {
    root = realpathSync.native(resolve(workspaceRoot))
    candidate = realpathSync.native(resolve(root, file))
  } catch {
    return null
  }
  const distance = relative(root, candidate)
  if (distance === '' || (!distance.startsWith('..') && !isAbsolute(distance))) return candidate
  return null
}

function toDiagnostic(vscodeApi, item) {
  const line = item.location.line - 1
  const range = new vscodeApi.Range(line, 0, line, 1)
  const diagnostic = new vscodeApi.Diagnostic(
    range,
    item.finding.summary,
    severityOf(vscodeApi, item),
  )
  diagnostic.source = SOURCE
  diagnostic.code = item.finding.id
  return diagnostic
}

function severityOf(vscodeApi, item) {
  return item.finding.severity === 'blocking'
    ? vscodeApi.DiagnosticSeverity.Error
    : vscodeApi.DiagnosticSeverity.Warning
}
