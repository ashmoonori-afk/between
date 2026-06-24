import { BetweenDecorationController } from './decorations.js'
import { BetweenDiagnosticsController } from './diagnostics.js'
import { BetweenIdePanel } from './ide-panel.js'
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
  const idePanel = new BetweenIdePanel(vscodeApi)
  const treeProvider = new BetweenTreeProvider(vscodeApi)
  const rootOf = overrides.workspaceRoot ?? (() => findWorkspaceRoot(vscodeApi))
  const readWorkspace = overrides.readWorkspace ?? readBetweenWorkspace
  const submitAction = overrides.submitAction ?? submitBetweenAction
  const evidenceMarkdown = overrides.evidenceMarkdown ?? buildEvidenceMarkdown

  context.subscriptions.push(
    diagnostics,
    decorations,
    idePanel,
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
      idePanel.update(view)
      return view
    } catch (error) {
      diagnosticsController.clear()
      decorations.clear(vscodeApi.window.activeTextEditor)
      treeProvider.fail(error)
      idePanel.fail(error)
      vscodeApi.window.showWarningMessage(`Between refresh failed: ${messageOf(error)}`)
      return null
    }
  }

  async function requestSecondReview() {
    await submitAction(rootOf(), { kind: 'request_second_review' })
    vscodeApi.window.showInformationMessage('Between review requested')
    await refresh()
  }

  async function askDeveloperToFix() {
    const message = await vscodeApi.window.showInputBox({ prompt: 'Message for the developer' })
    if (!message) return
    await submitAction(rootOf(), { kind: 'ask_developer_to_fix', message })
    vscodeApi.window.showInformationMessage('Between developer fix requested')
    await refresh()
  }

  async function submitBrokerInput(message) {
    const text = String(message).trim()
    if (!text) return
    await submitAction(rootOf(), { kind: 'broker_input', message: text })
    vscodeApi.window.showInformationMessage('Between broker command queued')
    await refresh()
  }

  async function openEvidence() {
    const view = await refresh()
    if (!view) return
    const document = await vscodeApi.workspace.openTextDocument({
      content: evidenceMarkdown(view),
      language: 'markdown',
    })
    await vscodeApi.window.showTextDocument(document)
  }

  async function approveExactBundle() {
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
    await refresh()
  }

  async function configureTopology(input) {
    await submitAction(rootOf(), {
      kind: 'configure_topology',
      builderAgentCount: input.builderAgentCount,
      reviewerAgentCount: input.reviewerAgentCount,
      permissionMode: input.permissionMode,
      workingFolder: input.workingFolder,
      followupMode: input.followupMode,
    })
    vscodeApi.window.showInformationMessage('Between IDE topology updated')
    await refresh()
  }

  register(context, vscodeApi, 'between.refresh', async () => {
    const view = await refresh()
    if (view) vscodeApi.window.showInformationMessage('Between refreshed')
  })
  register(context, vscodeApi, 'between.openIde', async () => {
    const view = await refresh()
    if (!view) return
    idePanel.open(view, {
      refresh,
      submitBrokerInput,
      requestSecondReview,
      openEvidence,
      approveExactBundle,
      configureTopology,
    })
  })
  register(context, vscodeApi, 'between.requestSecondReview', requestSecondReview)
  register(context, vscodeApi, 'between.askDeveloperToFix', askDeveloperToFix)
  register(context, vscodeApi, 'between.openEvidence', openEvidence)
  register(context, vscodeApi, 'between.approveExactBundle', approveExactBundle)

  refresh()
  return { refresh, diagnosticsController, decorations, treeProvider, idePanel }
}

function register(context, vscodeApi, command, fn) {
  context.subscriptions.push(vscodeApi.commands.registerCommand(command, fn))
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
