declare module 'write-file-atomic' {
  interface Options {
    chown?: { uid: number; gid: number } | false
    encoding?: BufferEncoding | null
    fsync?: boolean
    mode?: number
    tmpfileCreated?: (tmpfile: string) => void
  }
  function writeFileAtomic(
    filename: string,
    data: string | Buffer | Uint8Array,
    options?: Options,
  ): Promise<void>
  export default writeFileAtomic
}
