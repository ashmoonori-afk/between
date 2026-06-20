import * as vscode from 'vscode'
import { activateBetween } from './extension-core.js'

export function activate(context) {
  activateBetween(context, vscode)
}

export function deactivate() {}
