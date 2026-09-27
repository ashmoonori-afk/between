import { Command } from 'commander'
import { configureMcpCommand } from './cli/mcp-command'
import { VERSION } from './cli/shared'

// Dedicated `between-mcp` bin: same server start path as `between mcp`, without the CLI program.
const program = configureMcpCommand(new Command('between-mcp').version(VERSION))

program.parseAsync(process.argv).catch((e: unknown) => {
  process.stderr.write(`between-mcp: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exitCode = 1
})
