import { buildIdeProfileModel, topologyCard } from './ide-panel-profile.js'
import { styles } from './ide-panel-styles.js'
import { classToken, escapeHtml, textOf } from './ide-panel-util.js'

export class BetweenIdePanel {
  constructor(vscodeApi) {
    this.vscodeApi = vscodeApi
    this.panel = null
    this.actions = null
    this.disposables = []
  }

  open(view, actions) {
    this.actions = actions
    if (!this.panel) this.panel = this.createPanel()
    else this.panel.reveal(this.vscodeApi.ViewColumn.One)
    this.update(view)
  }

  update(view) {
    if (!this.panel) return
    this.panel.webview.html = renderBetweenIdeHtml(view, nonce())
  }

  fail(error) {
    if (!this.panel) return
    this.panel.webview.html = renderBetweenIdeErrorHtml(messageOf(error), nonce())
  }

  dispose() {
    for (const disposable of this.disposables.splice(0)) disposable.dispose()
    this.panel?.dispose()
    this.panel = null
  }

  createPanel() {
    const panel = this.vscodeApi.window.createWebviewPanel(
      'between.ide',
      'Between IDE',
      this.vscodeApi.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    )
    const messageSub = panel.webview.onDidReceiveMessage((message) => this.handleMessage(message))
    const disposeSub = panel.onDidDispose(() => {
      this.panel = null
    })
    this.disposables.push(messageSub, disposeSub)
    return panel
  }

  async handleMessage(message) {
    if (!this.actions || !message || typeof message.type !== 'string') return
    try {
      switch (message.type) {
        case 'refresh':
          await this.actions.refresh()
          return
        case 'brokerInput':
          await this.actions.submitBrokerInput(String(message.message ?? ''))
          return
        case 'requestSecondReview':
          await this.actions.requestSecondReview()
          return
        case 'openEvidence':
          await this.actions.openEvidence()
          return
        case 'approveExactBundle':
          await this.actions.approveExactBundle()
          return
        case 'configureTopology':
          await this.actions.configureTopology({
            builderAgentCount: Number(message.builderAgentCount),
            reviewerAgentCount: Number(message.reviewerAgentCount),
            permissionMode: String(message.permissionMode ?? ''),
            workingFolder: String(message.workingFolder ?? ''),
            followupMode: String(message.followupMode ?? ''),
          })
          return
        default:
          return
      }
    } catch (error) {
      this.vscodeApi.window.showWarningMessage(`Between IDE action failed: ${messageOf(error)}`)
    }
  }
}

export function buildBetweenIdeViewModel(view) {
  const findings = Array.isArray(view.model?.findings) ? view.model.findings : []
  const blocking = findings.filter((item) => item.finding?.severity === 'blocking').length
  return {
    project: textOf(view.project, 'Between'),
    phase: textOf(view.phase, 'unknown'),
    cycle: Number(view.cycle ?? 0),
    cyclesThisGoal: Number(view.cyclesThisGoal ?? 0),
    waitingOn: textOf(view.waitingOn ?? '-', '-'),
    bundleId: short(view.bundleId),
    diffHash: short(view.diffHash),
    changedFiles: Number(view.changedFiles ?? 0),
    evidenceVerdict: textOf(view.evidenceVerdict, 'unknown'),
    evidenceTrust: textOf(view.evidenceTrust, 'simulated'),
    canApprove: Boolean(view.canApprove),
    ideProfile: buildIdeProfileModel(view.ideProfile),
    developer: {
      name: textOf(view.developer, 'developer'),
      status: textOf(view.developerStatus, 'unknown'),
    },
    reviewer: {
      name: textOf(view.reviewer, 'reviewer'),
      status: textOf(view.reviewerStatus, 'unknown'),
    },
    blocking,
    totalFindings: findings.length,
    findings: findings.slice(0, 12).map((item, index) => {
      const finding = item.finding ?? {}
      return {
        id: textOf(finding.id, `F${index + 1}`),
        severity: textOf(finding.severity, 'note'),
        summary: textOf(finding.summary, 'No summary'),
        stale: Boolean(item.stale),
        linked: Boolean(item.linked),
        location: item.location
          ? `${textOf(item.location.file, '-')}:${Number(item.location.line ?? 0)}`
          : 'unlinked',
      }
    }),
  }
}

export function renderBetweenIdeHtml(view, pageNonce) {
  const model = buildBetweenIdeViewModel(view)
  const approveDisabled = model.canApprove ? '' : 'disabled'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${pageNonce}'; script-src 'nonce-${pageNonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Between IDE</title>
<style nonce="${pageNonce}">${styles()}</style>
</head>
<body data-between-ide>
  <main class="shell">
    <section class="broker lane">
      <header class="topline">
        <div>
          <p class="eyebrow">Between IDE</p>
          <h1>${escapeHtml(model.project)}</h1>
        </div>
        <div class="phase ${classToken(model.phase)}">${escapeHtml(model.phase)}</div>
      </header>
      <div class="metrics">
        ${metric('Cycle', String(model.cycle))}
        ${metric('Goal cycle', String(model.cyclesThisGoal))}
        ${metric('Waiting', model.waitingOn)}
        ${metric('Changed', String(model.changedFiles))}
      </div>
      <section class="strip">
        <div><span>Bundle</span><strong>${escapeHtml(model.bundleId)}</strong></div>
        <div><span>Diff</span><strong>${escapeHtml(model.diffHash)}</strong></div>
        <div><span>Evidence</span><strong>${escapeHtml(model.evidenceVerdict)}</strong></div>
      </section>
      <section class="findings">
        <div class="section-title">
          <span>Review feed</span>
          <strong>${model.blocking}/${model.totalFindings}</strong>
        </div>
        <div class="finding-list">${findingsHtml(model.findings)}</div>
      </section>
      <form id="broker-form" class="broker-input">
        <input id="broker-input" type="text" autocomplete="off" placeholder="Broker command">
        <button type="submit">Send</button>
      </form>
    </section>
    <aside class="rail">
      ${topologyCard(model.ideProfile)}
      ${agentCard('Developer', model.developer, 'developer')}
      ${agentCard('Reviewer', model.reviewer, 'reviewer')}
      <section class="gate lane">
        <div class="section-title"><span>Human gate</span><strong>${escapeHtml(model.evidenceTrust)}</strong></div>
        <button data-action="refresh">Refresh</button><button data-action="review">Review now</button><button data-action="abort">Abort</button><button data-action="evidence">Evidence</button><button data-action="approve" ${approveDisabled}>Approve exact bundle</button>
      </section>
    </aside>
  </main>
<script nonce="${pageNonce}">
const vscode = acquireVsCodeApi()
const form = document.getElementById('broker-form')
const input = document.getElementById('broker-input')
form.addEventListener('submit', (event) => {
  event.preventDefault()
  const message = input.value.trim()
  if (!message) return
  vscode.postMessage({ type: 'brokerInput', message })
  input.value = ''
})
document.querySelector('[data-action="refresh"]').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }))
document.querySelector('[data-action="review"]').addEventListener('click', () => vscode.postMessage({ type: 'requestSecondReview' }))
document.querySelector('[data-action="abort"]').addEventListener('click', () => vscode.postMessage({ type: 'brokerInput', message: '/abort' }))
document.querySelector('[data-action="evidence"]').addEventListener('click', () => vscode.postMessage({ type: 'openEvidence' }))
document.querySelector('[data-action="approve"]').addEventListener('click', () => vscode.postMessage({ type: 'approveExactBundle' }))
document.getElementById('topology-form').addEventListener('submit', (event) => {
  event.preventDefault()
  vscode.postMessage({
    type: 'configureTopology',
    builderAgentCount: document.getElementById('builder-count').value,
    reviewerAgentCount: document.getElementById('reviewer-count').value,
    permissionMode: document.getElementById('permission-mode').value,
    workingFolder: document.getElementById('working-folder').value,
    followupMode: document.getElementById('followup-mode').value
  })
})
</script>
</body>
</html>`
}

export function renderBetweenIdeErrorHtml(message, pageNonce) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${pageNonce}';"><style nonce="${pageNonce}">${styles()}</style></head><body><main class="shell"><section class="broker lane"><p class="eyebrow">Between IDE</p><h1>No workspace</h1><p class="error">${escapeHtml(message)}</p></section></main></body></html>`
}

function metric(label, value) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
}

function findingsHtml(findings) {
  if (findings.length === 0) return '<article class="finding empty">No current findings</article>'
  return findings
    .map(
      (item) => `<article class="finding ${classToken(item.severity)}">
        <div><strong>${escapeHtml(item.id)}</strong><span>${escapeHtml(item.location)}</span></div>
        <p>${escapeHtml(item.summary)}</p>
        <footer>${escapeHtml(item.severity)}${item.stale ? ' | stale' : ''}${item.linked ? ' | linked' : ''}</footer>
      </article>`,
    )
    .join('')
}

function agentCard(label, agent, role) {
  return `<section class="agent lane ${role}">
    <div class="section-title"><span>${escapeHtml(label)}</span><strong>${escapeHtml(agent.status)}</strong></div>
    <div class="agent-name">${escapeHtml(agent.name)}</div>
  </section>`
}

function nonce() {
  return Math.random().toString(36).slice(2, 12)
}

function short(value) {
  return value ? String(value).slice(0, 12) : '-'
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
