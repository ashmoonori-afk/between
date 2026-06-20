import * as vscode from 'vscode'

export function activate(context) {
  for (const command of [
    'between.refresh',
    'between.openEvidence',
    'between.requestSecondReview',
    'between.askDeveloperToFix',
  ]) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, () => {
        vscode.window.showInformationMessage(`${command} queued for Between`)
      }),
    )
  }
}

export function deactivate() {}
