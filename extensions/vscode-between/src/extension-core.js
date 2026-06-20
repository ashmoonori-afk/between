import { BetweenDecorationController } from './decorations.js'
import { BetweenDiagnosticsController } from './diagnostics.js'
import { BetweenTreeProvider } from './tree.js'
import {
  buildEvidenceMarkdown,
  findWorkspaceRoot,
  readBetweenWorkspace,
  submitBetweenAction,
} from './workspace.js'

export function activateBetween(context, vscodeApi, overrides = {}) {
  const diagnostics = vscodeApi.languages.createDiagnosticCollection('between')
  const diagnosticsController = new BetweenDiagnosticsController(vscodeApi, diagnostics)
  const decorations = new BetweenDecorationController(vscodeApi)
  const treeProvider = new BetweenTreeProvider(vscodeApi)
  const rootOf = overrides.workspaceRoot ?? (() => findWorkspaceRoot(vscodeApi))
  const readWorkspace = overrides.readWorkspace ?? readBetweenWorkspace
  const submitAction = overrides.submitAction ?? submitBetweenAction
  const evidenceMarkdown = overrides.evidenceMarkdown ?? buildEvidenceMarkdown

  context.subscriptions.push(
    diagnostics,
    decorations,
    { dispose: () => diagnosticsController.clear() },
    vscodeApi.window.createTreeView('between.panel', { treeDataProvider: treeProvider }),
  )

  async function refresh() {
    try {
      const root = rootOf()
      const view = await readWorkspace(root, new Date().toISOString())
      diagnosticsController.update(root, view.model)
      decorations.update(vscodeApi.window.activeTextEditor, root, view.model)
      treeProvider.update(view)
      return view
    } catch (error) {
      diagnosticsController.clear()
      decorations.clear(vscodeApi.window.activeTextEditor)
      treeProvider.fail(error)
      vscodeApi.window.showWarningMessage(`Between refresh failed: ${messageOf(error)}`)
      return null
    }
  }

  register(context, vscodeApi, 'between.refresh', async () => {
    const view = await refresh()
    if (view) vscodeApi.window.showInformationMessage('Between refreshed')
  })
  register(context, vscodeApi, 'between.requestSecondReview', async () => {
    await submitAction(rootOf(), { kind: 'request_second_review' })
    vscodeApi.window.showInformationMessage('Between review requested')
  })
  register(context, vscodeApi, 'between.askDeveloperToFix', async () => {
    const message = await vscodeApi.window.showInputBox({ prompt: 'Message for the developer' })
    if (!message) return
    await submitAction(rootOf(), { kind: 'ask_developer_to_fix', message })
    vscodeApi.window.showInformationMessage('Between developer fix requested')
  })
  register(context, vscodeApi, 'between.openEvidence', async () => {
    const view = await refresh()
    if (!view) return
    const document = await vscodeApi.workspace.openTextDocument({
      content: evidenceMarkdown(view),
      language: 'markdown',
    })
    await vscodeApi.window.showTextDocument(document)
  })
  register(context, vscodeApi, 'between.approveExactBundle', async () => {
    const view = await refresh()
    if (!view) return
    if (!view.canApprove) {
      vscodeApi.window.showWarningMessage('Between exact bundle approval requires real evidence.')
      return
    }
    const result = await submitAction(rootOf(), { kind: 'approve_exact_bundle' })
    vscodeApi.window.showInformationMessage(
      result?.signed === false
        ? 'Between exact bundle approval queued unsigned'
        : 'Between exact bundle approval queued',
    )
  })

  refresh()
  return { refresh, diagnosticsController, decorations, treeProvider }
}

function register(context, vscodeApi, command, fn) {
  context.subscriptions.push(vscodeApi.commands.registerCommand(command, fn))
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
