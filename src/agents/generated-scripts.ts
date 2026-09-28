import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FAKE_AGENT_SOURCE } from './fake-agent'
import { CLAUDE_AGENT_SOURCE, CODEX_AGENT_SOURCE } from './real-agents'

export const GENERATED_AGENT_SCRIPTS: Readonly<Record<string, string>> = {
  'fake-agent.mjs': FAKE_AGENT_SOURCE,
  'claude-agent.mjs': CLAUDE_AGENT_SOURCE,
  'codex-agent.mjs': CODEX_AGENT_SOURCE,
}

/**
 * sha256 of every script an earlier Between release generated. A file whose bytes still match one
 * of these was never customized, so it is safe to replace with the current source (which carries
 * the developer write-deny rules and the write-once record contract). Customized files are kept.
 */
export const LEGACY_SHA256: Readonly<Record<string, readonly string[]>> = {
  'fake-agent.mjs': ['456668e40c87c12902b0edf958f24ab4697c3e1aa60e6a2fa13e7647f6a81d28'],
  'claude-agent.mjs': [
    'f0c1c88491d08fa06bb186e548d41e21662157d7b47cded902ad3853959bc504',
    '57bcf6c484952c6f5634367ed257457a714857c447d6d19366934c08133161b4',
    '9ca8e2fe2533e0d4ecd486919ed28fc246754418a6b8710294cc11217354ae2e',
    '1a62257100f2b3f31204358600ee4b2bfc66beca934615912006e6154ec54ad2',
    'e3d84df305f592f60ee1c5a3b1db6b5b7308f81809ff44bce3ca4e217aa654ff',
  ],
  'codex-agent.mjs': [
    'a7b5341f7aedaaa8c35dfc37224f56c5be36fc07afe779e0db22985b15ed5e4e',
    'f39bf7d7e76349489133103a4aef96361f1cee2a473ef8ed9578c46d4a9c2a7b',
    '614e27193a95dbc4d3c3f0f957bb2883c6e5c26919785e8df903c580b4d2b3dd',
    '7ba066059f8ce64b763cb6d1f167b96b422c201d1dcd9d34c72ea57b265017b8',
    'a4812c27f976bac82e4ec984b9e61004ddee0aebaa5fea2cf4fb28fac6fa2b1a',
  ],
}

export async function upgradePristineAgentScripts(
  agentsDir: string,
  legacy: Readonly<Record<string, readonly string[]>> = LEGACY_SHA256,
): Promise<string[]> {
  const upgraded: string[] = []
  for (const [name, source] of Object.entries(GENERATED_AGENT_SCRIPTS)) {
    const file = join(agentsDir, name)
    let current: string
    try {
      current = await readFile(file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw e
    }
    const hash = createHash('sha256').update(current, 'utf8').digest('hex')
    if (!legacy[name]?.includes(hash)) continue
    await writeFile(file, source, 'utf8')
    upgraded.push(file)
  }
  return upgraded
}
