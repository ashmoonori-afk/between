import { Command } from 'commander'
import { VERSION } from './shared'
import { registerBrokerCommands } from './broker-commands'
import { registerEvidenceCommand } from './evidence-command'
import { registerReviewCommand } from './review-command'
import { registerForgeCommands } from './forge-commands'
import { registerGatewayCommand } from './gateway-command'
import { registerSetupCommands } from './setup-commands'

export function buildProgram(): Command {
  const program = new Command()
  program
    .name('between')
    .description('A local terminal broker for AI pair development.')
    .version(VERSION)

  registerSetupCommands(program)
  registerBrokerCommands(program)
  registerEvidenceCommand(program)
  registerReviewCommand(program)
  registerGatewayCommand(program)
  registerForgeCommands(program)

  return program
}
