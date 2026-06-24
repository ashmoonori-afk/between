import { SystemClock } from '../core/clock'
import {
  ensureProjectStartBootstrap,
  formatProjectStartBootstrap,
} from '../adapters/project-bootstrap'
import { loadConfig, runStart } from '../runtime'
import { print } from './output'

export interface StartCommandOptions {
  readonly embed?: boolean
  readonly headless?: boolean
  readonly maxTicks?: number
}

export async function runStartCommand(root: string, opts: StartCommandOptions): Promise<void> {
  const bootstrap = await ensureProjectStartBootstrap(root, {
    clock: new SystemClock(),
    preferPty: Boolean(opts.embed) && !opts.headless,
  })
  for (const line of formatProjectStartBootstrap(bootstrap)) print(line)
  const cfg = await loadConfig(root).catch(() => null)
  const embed = Boolean(opts.embed) || (cfg !== null && cfg.agent_mode !== 'file')
  if (embed) {
    const { runStartEmbedded } = await import('../ui/start')
    await runStartEmbedded(root, { maxTicks: opts.maxTicks, headless: opts.headless })
    return
  }
  print('between: broker started (headless file mode). Ctrl-C to stop.')
  await runStart(root, { maxTicks: opts.maxTicks })
  print('between: broker stopped.')
}
