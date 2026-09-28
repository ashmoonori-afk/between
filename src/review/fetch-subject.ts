import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'

/**
 * SSRF-guarded fetch of a review subject. Every hop (the first request and each redirect) is
 * checked: IP-literal hosts directly, host names inside the socket's DNS lookup, so the address
 * that is checked is the address that is connected to (no DNS-rebinding window). Loopback,
 * private, link-local (cloud metadata), CGNAT, multicast, and reserved ranges are refused. The
 * body is streamed and the request aborted as soon as it passes `maxBytes`.
 */

const NON_PUBLIC = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv4')
}
// IPv6 is an allowlist: only global unicast (2000::/3) passes, minus the special-purpose blocks
// inside it. Everything else (site-local fec0::/10, ULA, link-local, NAT64 64:ff9b::/96 and
// 64:ff9b:1::/48, IPv4-compatible and IPv4-translated forms, multicast) is refused.
const GLOBAL_UNICAST_V6 = new BlockList()
GLOBAL_UNICAST_V6.addSubnet('2000::', 3, 'ipv6')
const SPECIAL_IN_GLOBAL_V6 = new BlockList()
for (const [net, prefix] of [
  ['2001::', 23], // IETF protocol assignments, incl. Teredo 2001::/32 (embeds IPv4)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 (embeds IPv4)
  ['3fff::', 20], // documentation
] as const) {
  SPECIAL_IN_GLOBAL_V6.addSubnet(net, prefix, 'ipv6')
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address)
  if (family === 4) return !NON_PUBLIC.check(address, 'ipv4')
  if (family !== 6) return false
  const mapped = ipv4FromMapped(address)
  if (mapped) return !NON_PUBLIC.check(mapped, 'ipv4')
  return GLOBAL_UNICAST_V6.check(address, 'ipv6') && !SPECIAL_IN_GLOBAL_V6.check(address, 'ipv6')
}

/** `::ffff:a.b.c.d` in any spelling -> `a.b.c.d`; null for every other address. */
function ipv4FromMapped(address: string): string | null {
  let host: string
  try {
    host = new URL(`http://[${address}]/`).hostname.slice(1, -1)
  } catch {
    return null
  }
  const m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host)
  if (!m) return null
  const hi = parseInt(m[1]!, 16)
  const lo = parseInt(m[2]!, 16)
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
}

export class SubjectFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubjectFetchError'
  }
}

export interface FetchSubjectOptions {
  maxBytes: number
  timeoutMs: number
  maxRedirects?: number
  /** test seam; production always uses isPublicAddress */
  allowAddress?: (address: string) => boolean
}

export async function fetchSubjectText(url: string, opts: FetchSubjectOptions): Promise<string> {
  const allow = opts.allowAddress ?? isPublicAddress
  const maxRedirects = opts.maxRedirects ?? 5
  const signal = AbortSignal.timeout(opts.timeoutMs)
  let current = new URL(url)
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    assertFetchable(current, allow)
    const res = await getOnce(current, opts.maxBytes, allow, signal).catch((e: unknown) => {
      if (signal.aborted) throw new SubjectFetchError(`timed out after ${opts.timeoutMs} ms`)
      throw e instanceof SubjectFetchError
        ? e
        : new SubjectFetchError(e instanceof Error ? e.message : String(e))
    })
    if (res.location === undefined) return res.body
    current = new URL(res.location, current)
  }
  throw new SubjectFetchError(`more than ${maxRedirects} redirects`)
}

function assertFetchable(url: URL, allow: (address: string) => boolean): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SubjectFetchError(`only http(s) URLs can be fetched: ${url.href}`)
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && !allow(host)) {
    throw new SubjectFetchError(`refusing to fetch from a non-public address: ${host}`)
  }
}

function guardedLookup(allow: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
      if (err) return callback(err, '', 0)
      const blocked = addresses.find((a) => !allow(a.address))
      if (blocked || addresses.length === 0) {
        const reason = blocked
          ? `refusing to fetch from a non-public address: ${hostname} -> ${blocked.address}`
          : `no address for ${hostname}`
        return callback(new SubjectFetchError(reason), '', 0)
      }
      if (options.all) return callback(null, addresses)
      return callback(null, addresses[0]!.address, addresses[0]!.family)
    })
  }
}

type Hop = { location: string; body?: undefined } | { location?: undefined; body: string }

function getOnce(
  url: URL,
  maxBytes: number,
  allow: (address: string) => boolean,
  signal: AbortSignal,
): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(
      url,
      {
        method: 'GET',
        lookup: guardedLookup(allow),
        signal,
        headers: { 'user-agent': 'between-review', accept: 'text/*, application/json;q=0.9' },
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          resolve({ location: res.headers.location })
          return
        }
        if (status < 200 || status >= 300) {
          res.resume()
          reject(new SubjectFetchError(`HTTP ${status}`))
          return
        }
        const declared = Number(res.headers['content-length'] ?? 0)
        if (declared > maxBytes) {
          res.destroy()
          reject(new SubjectFetchError(`body is ${declared} bytes; the limit is ${maxBytes}`))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) {
            res.destroy()
            reject(new SubjectFetchError(`body exceeds the ${maxBytes}-byte limit`))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}
