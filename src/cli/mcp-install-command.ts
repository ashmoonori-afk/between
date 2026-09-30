import { resolve } from 'node:path'
import type { Command } from 'commander'
import { BetweenApiError } from '../api/errors'
import type { HostAgent } from '../review/direct'
import {
  manageMcpRegistration,
  registrationCommands,
  type RegistrationResult,
} from '../onboard/mcp-registration'
import {
  installQuickReviewCommand,
  quickReviewPath,
  renderQuickReviewCommand,
  uninstallQuickReviewCommand,
  type FileResult,
} from '../onboard/mcp-install'
import { print } from './output'
import { root } from './shared'

interface McpInstallOptions {
  readonly register: boolean
  readonly print?: boolean
}

export function registerMcpInstallCommands(program: Command): void {
  register(program, 'install')
  register(program, 'uninstall')
}

function register(program: Command, action: 'install' | 'uninstall'): void {
  const installing = action === 'install'
  program
    .command(`mcp-${action}`)
    .description(
      installing
        ? 'Install Between MCP and quick-review commands'
        : 'Remove managed Between MCP and quick-review commands',
    )
    .argument('[hosts...]', 'claude, codex, or both when omitted')
    .option('--no-register', 'manage command files only')
    .option('--print', 'show files and commands without changing anything')
    .action(async (values: string[], options: McpInstallOptions) => {
      const hosts = parseHosts(values)
      const projectRoot = resolve(root())
      if (options.print) {
        for (const host of hosts) {
          printPreview(action, host, { projectRoot, includeRegistration: options.register })
        }
        return
      }
      let failed = false
      for (const host of hosts) {
        const file =
          action === 'install'
            ? await installQuickReviewCommand(host)
            : await uninstallQuickReviewCommand(host)
        printFileResult(host, file)
        if (!options.register) continue
        const registration = await manageMcpRegistration(action, host, { projectRoot })
        printRegistrationResult(host, registration)
        if (registration.status.startsWith('failed')) failed = true
      }
      if (failed) process.exitCode = 1
    })
}

function parseHosts(values: readonly string[]): readonly HostAgent[] {
  const hosts = values.length === 0 ? ['claude', 'codex'] : values
  const parsed: HostAgent[] = []
  for (const host of hosts) {
    if (host !== 'claude' && host !== 'codex') {
      throw new BetweenApiError('invalid_argument', `host must be claude or codex: ${host}`)
    }
    if (!parsed.includes(host)) parsed.push(host)
  }
  return parsed
}

function printPreview(
  action: 'install' | 'uninstall',
  host: HostAgent,
  options: { readonly projectRoot: string; readonly includeRegistration: boolean },
): void {
  const path = quickReviewPath(host)
  if (action === 'install') {
    print(`between: would write ${path}`)
    process.stdout.write(renderQuickReviewCommand(host))
  } else {
    print(`between: would remove managed file ${path}`)
  }
  if (!options.includeRegistration) return
  for (const command of registrationCommands(action, host, options)) {
    print(`between: would run ${[command.file, ...command.args].join(' ')}`)
  }
}

function printFileResult(host: HostAgent, result: FileResult): void {
  const label = host === 'claude' ? 'Claude Code command' : 'Codex skill'
  const status =
    result.status === 'skipped_user_edited'
      ? 'skipped: user-edited'
      : result.status.replaceAll('_', ' ')
  print(`between: ${label}: ${status} (${result.path})`)
}

function printRegistrationResult(host: HostAgent, result: RegistrationResult): void {
  const label = host === 'claude' ? 'Claude Code MCP' : 'Codex MCP'
  const status =
    result.status === 'skipped_missing_cli'
      ? `skipped: ${host} CLI not found`
      : result.status === 'already_registered_pinned'
        ? `already registered: ${result.hint}`
        : result.status === 'skipped_unsupported_batch'
          ? `skipped: ${host} is a batch file that is not an npm shim`
          : result.status === 'failed_scope_mismatch'
            ? `failed: local scope removal did not succeed; ${result.hint}`
            : result.status.replaceAll('_', ' ')
  print(`between: ${label}: ${status}`)
}
