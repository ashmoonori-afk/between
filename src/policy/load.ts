import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { DEFAULT_POLICY, parsePolicy, type Policy } from './schema'

export function policyPath(root: string): string {
  return join(resolve(root), '.between', 'policy.yaml')
}

/** Load `.between/policy.yaml`, or the fully-defaulted policy when none exists. */
export async function loadPolicy(root: string): Promise<Policy> {
  const path = policyPath(root)
  if (!existsSync(path)) return DEFAULT_POLICY
  return parsePolicy(parseYaml(await readFile(path, 'utf8')))
}
