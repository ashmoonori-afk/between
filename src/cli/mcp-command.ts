import { Command } from 'commander'
import { printErr } from './output'

export interface McpCommandOptions {
  root?: string
  allowControl?: boolean
  allowExec?: boolean
  allowReview?: boolean
}

export function configureMcpCommand(command: Command): Command {
  return command
    .description('Run the Between MCP server over stdio (for MCP clients)')
    .option('--root <path>', 'project root to pin the server to (default: $BETWEEN_ROOT or cwd)')
    .option('--allow-control', 'expose broker control tools (pause/resume/interrupt/goal/steer...)')
    .option('--allow-exec', 'expose tools that run repo-configured commands (verify, policy)')
    .option(
      '--allow-review',
      'expose between_review (runs the claude/codex CLI; sends the subject to that provider)',
    )
    .action(async (opts: McpCommandOptions) => {
      try {
        const { runMcpServer } = await import('../mcp/server')
        await runMcpServer(opts)
      } catch (e) {
        printErr(`between-mcp: ${e instanceof Error ? e.message : String(e)}`)
        process.exitCode = 1
      }
    })
}

export function registerMcpCommand(program: Command): void {
  configureMcpCommand(program.command('mcp'))
}
