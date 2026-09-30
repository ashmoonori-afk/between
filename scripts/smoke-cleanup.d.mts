export interface CleanupOptions {
  remove?: (dir: string) => Promise<void>
  attempts?: number
  delayMs?: number
  warn?: (message: string) => void
}
export function removeWorkDir(dir: string, options?: CleanupOptions): Promise<boolean>
export function withWorkDir<T>(
  dir: string,
  body: () => Promise<T>,
  options?: CleanupOptions,
): Promise<T>
