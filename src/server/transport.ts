/**
 * HTTP transport for the Node server SDK.
 *
 * Uses node:http/node:https directly rather than global fetch. fetch (undici) keeps a
 * pooled keep-alive socket that can hold the event loop open past the end of a short-lived
 * script, which is exactly the case — a cron job, a Lambda — where losing the final batch
 * matters most. A plain request we control can be unref'd and ended deterministically.
 *
 * Sent uncompressed, deliberately. The ingest endpoint reads the body and JSON.parses it
 * directly; Django does not decompress request bodies, so a Content-Encoding: gzip request
 * comes back 400 "Invalid JSON" — and 400 is not retryable, so those events vanish. The
 * Python SDK shipped that bug once; not repeating it here.
 */
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { URL } from 'node:url'

/** Worth trying again. Any other 4xx means the request is wrong and will stay wrong. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

export interface TransportResult {
  ok: boolean
  status?: number
}

export class Transport {
  private endpoint: string
  private apiKey: string
  private timeoutMs: number
  private maxRetries: number
  private userAgent: string
  private debug: boolean

  /** Set when the server tells us to back off. Until it passes we drop rather than send —
   *  a struggling ingest endpoint must not be hammered by every app server at once. */
  private blockedUntil = 0
  /**
   * Network failures are logged at debug only, which means an SDK that cannot reach the
   * server at all — blocked egress, TLS failure, bad DNS — would say nothing under a
   * normal logging setup. For a tool whose job is telling you when things break, failing
   * invisibly is the worst mode. Warn once on becoming unreachable, once on recovery.
   */
  private unreachable = false
  private lastError: Error | null = null

  constructor(opts: {
    endpoint: string
    apiKey: string
    timeoutMs?: number
    maxRetries?: number
    userAgent: string
    debug?: boolean
  }) {
    this.endpoint = opts.endpoint
    this.apiKey = opts.apiKey
    this.timeoutMs = opts.timeoutMs ?? 5000
    this.maxRetries = opts.maxRetries ?? 3
    this.userAgent = opts.userAgent
    this.debug = opts.debug ?? false
  }

  /** Send a batch. Resolves true if accepted. Never rejects. */
  async send(events: unknown[]): Promise<boolean> {
    if (!events.length) return true
    if (Date.now() < this.blockedUntil) {
      this.log(`rate limited by server, dropping ${events.length} event(s)`)
      return false
    }

    let body: string
    try {
      body = JSON.stringify({ events, apiKey: this.apiKey })
    } catch (err) {
      // A value that cannot be serialised must not take the process down. scrub()
      // normally prevents this; this is the backstop.
      this.warn(`could not serialise ${events.length} event(s) — dropped (${String(err)})`)
      return false
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const { ok, retryable, retryAfter } = await this.attempt(body)
      if (ok) {
        if (this.unreachable) {
          this.warn(`connection to ${this.endpoint} restored`)
          this.unreachable = false
        }
        return true
      }
      if (!retryable || attempt === this.maxRetries) {
        if (retryable && this.lastError && !this.unreachable) {
          this.unreachable = true
          this.warn(
            `cannot reach ${this.endpoint} (${this.lastError.message}) — events are being ` +
            'dropped. Check outbound network access and TLS from this host.',
          )
        }
        return false
      }
      if (retryAfter != null) {
        this.blockedUntil = Date.now() + retryAfter * 1000
        return false
      }
      // Full jitter, so N app servers retrying after a blip do not resynchronise into a
      // thundering herd.
      await sleep(Math.random() * Math.min(2 ** attempt, 8) * 1000)
    }
    return false
  }

  private attempt(body: string): Promise<{
    ok: boolean; retryable: boolean; retryAfter: number | null
  }> {
    // Cleared per attempt so a stale network error cannot make a later HTTP 5xx look like
    // an unreachable host.
    this.lastError = null

    return new Promise((resolve) => {
      let url: URL
      try {
        url = new URL(this.endpoint)
      } catch (err) {
        // A typo'd endpoint can never start working. Fail fast and say so once.
        this.warn(`invalid endpoint ${this.endpoint} — events dropped`)
        resolve({ ok: false, retryable: false, retryAfter: null })
        return
      }

      const doRequest = url.protocol === 'https:' ? httpsRequest : httpRequest
      let settled = false
      const finish = (r: { ok: boolean; retryable: boolean; retryAfter: number | null }) => {
        if (settled) return
        settled = true
        resolve(r)
      }

      const req = doRequest(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            'X-API-Key': this.apiKey,
            'User-Agent': this.userAgent,
          },
        },
        (res) => {
          const status = res.statusCode ?? 0
          // Drain, or the socket is never released back to the pool.
          res.resume()
          res.on('end', () => {
            if (status >= 200 && status < 300) {
              finish({ ok: true, retryable: false, retryAfter: null })
              return
            }
            if (status === 401 || status === 403) {
              // A bad API key will never start working. Say so once, loudly.
              this.warn(`rejected (HTTP ${status}) — check your API key`)
              finish({ ok: false, retryable: false, retryAfter: null })
              return
            }
            let retryAfter: number | null = null
            if (status === 429 || status === 503) {
              const raw = res.headers['retry-after']
              const n = Number(Array.isArray(raw) ? raw[0] : raw)
              retryAfter = Number.isFinite(n) ? Math.max(0, n) : null
            }
            finish({ ok: false, retryable: RETRYABLE_STATUS.has(status), retryAfter })
          })
        },
      )

      req.setTimeout(this.timeoutMs, () => {
        this.lastError = new Error(`timeout after ${this.timeoutMs}ms`)
        req.destroy()
        finish({ ok: false, retryable: true, retryAfter: null })
      })

      req.on('error', (err: Error) => {
        this.lastError = err
        this.log(`send failed (${err.message})`)
        finish({ ok: false, retryable: true, retryAfter: null })
      })

      req.end(body)
    })
  }

  private log(msg: string): void {
    if (this.debug) console.log(`nohmo: ${msg}`)
  }

  private warn(msg: string): void {
    console.warn(`nohmo: ${msg}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // unref so a pending backoff can never hold a short-lived process open.
    const t = setTimeout(resolve, ms)
    if (typeof t.unref === 'function') t.unref()
  })
}
