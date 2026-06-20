export function normalizeRepoRelativePath(path: string): string | null {
  if (path.includes('\0')) return null
  const slash = path.replaceAll('\\', '/')
  if (slash.startsWith('/') || /^[A-Za-z]:\//.test(slash)) return null
  const parts: string[] = []
  for (const part of slash.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') return null
    parts.push(part)
  }
  return parts.length === 0 ? null : parts.join('/')
}

export function isDeniedUntrackedPath(path: string): boolean {
  const normalized = normalizeRepoRelativePath(path)
  if (!normalized) return true
  if (normalized === '.between' || normalized.startsWith('.between/')) return true
  return normalized.split('/').some((part) => part.startsWith('.env'))
}
