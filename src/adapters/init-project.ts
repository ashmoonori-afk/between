import { mkdir, readFile, writeFile, access, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { stringify as yamlStringify } from 'yaml'
import type { Clock, ProjectRef } from '../core/types'
import { defaultConfigYaml } from '../core/config-schema'
import { initialState } from '../core/state'
import { StateRepository } from './state-repository'
import { betweenPaths, betweenSubdirs } from './paths'

export interface InitOptions {
  vaultPath?: string
}

export interface InitResult {
  created: string[]
  alreadyExisted: boolean
  project: ProjectRef
}

/** Create `.between/` scaffolding, config, initial state, and a `.gitignore` entry (idempotent). */
export async function initProject(
  root: string,
  opts: InitOptions,
  clock: Clock,
): Promise<InitResult> {
  const absRoot = resolve(root)
  const p = betweenPaths(absRoot)
  const created: string[] = []
  const existedBefore = existsSync(p.state)

  for (const dir of betweenSubdirs(p)) {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
      created.push(dir)
    }
  }

  let vaultPath = opts.vaultPath?.trim()
  if (vaultPath) {
    // I25 / security M4: validate the vault is an existing directory before storing it
    vaultPath = resolve(vaultPath)
    let isDir = false
    try {
      isDir = (await stat(vaultPath)).isDirectory()
    } catch {
      isDir = false
    }
    if (!isDir) throw new Error(`--vault path is not an existing directory: ${vaultPath}`)
  }
  const project: ProjectRef = {
    name: basename(absRoot),
    root: absRoot,
    obsidian_project_path: vaultPath
      ? join(vaultPath, 'Between', 'Projects', basename(absRoot))
      : null,
  }

  if (!existsSync(p.config)) {
    let body = defaultConfigYaml()
    if (vaultPath) {
      // serialize via the YAML library so a path with quotes/backslashes/newlines is safe (H1)
      body = body.replace("vault_path: ''", `vault_path: ${yamlStringify(vaultPath).trim()}`)
    }
    await writeFile(p.config, body, 'utf8')
    created.push(p.config)
  }

  if (!existsSync(p.state)) {
    const repo = new StateRepository(absRoot)
    await repo.write(initialState({ project }, clock))
    created.push(p.state)
  }

  await ensureGitignore(absRoot)

  return { created, alreadyExisted: existedBefore, project }
}

/** Ensure `.between/` is gitignored so the broker's own writes can't self-trigger the loop (I22). */
async function ensureGitignore(root: string): Promise<void> {
  const file = join(root, '.gitignore')
  const entry = '.between/'
  let contents = ''
  try {
    await access(file)
    contents = await readFile(file, 'utf8')
  } catch {
    // no .gitignore yet
  }
  const lines = contents.split(/\r?\n/).map((l) => l.trim())
  if (lines.includes(entry)) return
  const next =
    contents.length > 0 && !contents.endsWith('\n')
      ? `${contents}\n${entry}\n`
      : `${contents}${entry}\n`
  await writeFile(file, next, 'utf8')
}
