export class BetweenTreeProvider {
  constructor(vscodeApi) {
    this.vscodeApi = vscodeApi
    this.onDidChangeTreeDataEmitter = new vscodeApi.EventEmitter()
    this.onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event
    this.view = null
    this.error = null
  }

  update(view) {
    this.view = view
    this.error = null
    this.onDidChangeTreeDataEmitter.fire(view)
  }

  fail(error) {
    this.view = null
    this.error = error instanceof Error ? error.message : String(error)
    this.onDidChangeTreeDataEmitter.fire(null)
  }

  getChildren() {
    if (this.error) return [this.item(`No workspace: ${this.error}`, 'warning')]
    if (!this.view) return [this.item('Refresh Between', 'sync', 'between.refresh')]
    const blocking = this.view.model.findings.filter((item) => item.finding.severity === 'blocking')
    const approvalItem = this.view.canApprove
      ? this.item('Approve exact bundle', 'verified', 'between.approveExactBundle')
      : this.item('Approval locked: real evidence required', 'lock')
    return [
      this.item('Open Between IDE', 'layout', 'between.openIde'),
      this.item(
        `${this.view.project} | ${this.view.phase} | cycle ${this.view.cycle}`,
        'circuit-board',
      ),
      this.item(`bundle ${short(this.view.bundleId)}`, 'package'),
      this.item(
        `${blocking.length} blocking / ${this.view.model.findings.length} findings`,
        'warning',
      ),
      this.item('Open evidence', 'book', 'between.openEvidence'),
      this.item('Request second review', 'comment-discussion', 'between.requestSecondReview'),
      this.item('Ask developer to fix', 'tools', 'between.askDeveloperToFix'),
      approvalItem,
    ]
  }

  getTreeItem(element) {
    return element
  }

  item(label, icon, command) {
    const item = new this.vscodeApi.TreeItem(label, this.vscodeApi.TreeItemCollapsibleState.None)
    item.iconPath = icon ? new this.vscodeApi.ThemeIcon(icon) : undefined
    item.command = command ? { command, title: label } : undefined
    return item
  }
}

function short(value) {
  return value ? value.slice(0, 12) : '-'
}
