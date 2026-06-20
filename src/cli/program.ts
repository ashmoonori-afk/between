import { Command } from 'commander'
import { VERSION } from './shared'
import { registerBrokerCommands } from './broker-commands'
import { registerEvidenceCommand } from './evidence-command'
import { registerReviewCommand } from './review-command'
import { registerPolicyCommand } from './policy-command'
import { registerVerifyCommand } from './verify-command'
import { registerJournalCommand } from './journal-command'
import { registerReplayCommand } from './replay-command'
import { registerCockpitCommand } from './cockpit-command'
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
  registerPolicyCommand(program)
  registerVerifyCommand(program)
  registerJournalCommand(program)
  registerReplayCommand(program)
  registerCockpitCommand(program)
  registerGatewayCommand(program)
  registerForgeCommands(program)

  return program
}
