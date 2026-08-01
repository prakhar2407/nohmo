/**
 * The Node server client.
 *
 * Mirrors nohmo-sdk (Python) so both backends behave identically: same event type, same
 * platform, same dedup and sampling semantics, same PII posture. Where the two differ it
 * is because the runtime forces it, and those places are commented.
 */
import { hostname } from 'node:os'
import { scrub } from './scrub'
import { Transport } from './transport'
import type {
  CaptureOptions, NohmoServerOptions, RequestContext, ServerEvent, UserContext,
} from './types'

export const DEFAULT_ENDPOINT = 'https://www.nohmo.in/api/tracker/track/'

const DEFAULT_QUEUE_SIZE = 1000
const DEFAULT_BATCH_SIZE = 50
const DEFAULT_FLUSH_INTERVAL = 5      // seconds
const DEFAULT_DEDUP_WINDOW = 5        // seconds

const MAX_MESSAGE_CHARS = 1000
const MAX_STACK_CHARS = 8000

/** Read at module load so the bundled build has no import-time cost per event. */
const SDK_VERSION = '__NOHMO_VERSION__'

export class ServerClient {
  private projectId: string
  private apiKey: string
  private environment: string
  private release: string
  private serverName: string
  private sampleRate: number
  private dedupWindow: number
  private queueSize: number
  private batchSize: number
  private sendDefaultPii: boolean
  private debug: boolean

  private transport: Transport
  private queue: ServerEvent[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  /** Signature -> last-sent epoch ms, for the dedup window. */
  private recent = new Map<string, number>()
  private closed = false
  /** Number of in-flight sends, so flush() can wait for real completion. */
  private inFlight = 0

  readonly instanceId: string

  constructor(opts: NohmoServerOptions) {
    this.projectId = opts.projectId
    this.apiKey = opts.apiKey
    this.environment = opts.environment ?? 'production'
    this.release = opts.release ?? ''
    this.serverName = opts.serverName ?? safeHostname()
    this.sampleRate = clamp(opts.sampleRate ?? 1, 0, 1)
    this.dedupWindow = opts.dedupWindow ?? DEFAULT_DEDUP_WINDOW
    this.queueSize = opts.queueSize ?? DEFAULT_QUEUE_SIZE
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE
    this.sendDefaultPii = opts.sendDefaultPii ?? false
    this.debug = opts.debug ?? false

    // One "device" per process, so the dashboard can tell instances apart without
    // treating every request as a new visitor.
    this.instanceId = `server:${this.serverName}:${process.pid}`

    this.transport = new Transport({
      endpoint: opts.endpoint ?? DEFAULT_ENDPOINT,
      apiKey: this.apiKey,
      userAgent: `nohmo-node/${SDK_VERSION}`,
      debug: this.debug,
    })

    const intervalMs = (opts.flushInterval ?? DEFAULT_FLUSH_INTERVAL) * 1000
    this.timer = setInterval(() => { void this.drain() }, intervalMs)
    // unref is the whole difference from the Python design: a Node timer keeps the event
    // loop alive, so without this an app that imports the SDK would simply never exit.
    if (typeof this.timer.unref === 'function') this.timer.unref()
  }

  captureException(err: unknown, opts: CaptureOptions = {}): void {
    const { message, type, stack } = describeError(err)
    this.enqueue(message, type, stack, opts)
  }

  captureMessage(message: string, opts: CaptureOptions = {}): void {
    this.enqueue(String(message), 'Message', '', { handled: true, ...opts })
  }

  /**
   * Send everything queued and wait for it. Resolves false if anything was dropped.
   *
   * Node has no background thread, so unlike the Python SDK there is nothing to join —
   * what we wait on is the in-flight request promises.
   */
  async flush(timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    let ok = await this.drain()
    while (this.inFlight > 0 && Date.now() < deadline) {
      await sleep(20)
    }
    if (this.queue.length) ok = false
    return ok
  }

  /** Flush and stop the timer. After this the client accepts nothing further. */
  async close(timeoutMs = 3000): Promise<boolean> {
    const ok = await this.flush(timeoutMs)
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.closed = true
    return ok
  }

  // ── internals ────────────────────────────────────────────────────────────
  private enqueue(
    message: string, type: string, stack: string, opts: CaptureOptions,
  ): void {
    if (this.closed) return
    try {
      if (this.sampleRate < 1 && Math.random() >= this.sampleRate) return

      // Dedup on the shape of the error, not its text alone, so a hot loop reports once
      // per window instead of thousands of times.
      const sig = `${type}|${firstFrame(stack)}|${message.slice(0, 200)}`
      const now = Date.now()
      const last = this.recent.get(sig)
      if (last != null && now - last < this.dedupWindow * 1000) return
      this.recent.set(sig, now)
      if (this.recent.size > 500) this.pruneRecent(now)

      const event = this.buildEvent(message, type, stack, opts)

      if (this.queue.length >= this.queueSize) {
        // Bounded on purpose. A crash loop generates errors faster than any network can
        // ship them; an unbounded queue there is a memory leak that ends in an OOM kill —
        // the SDK becoming the outage. Drop the oldest, keep the newest.
        this.queue.shift()
      }
      this.queue.push(event)
      if (this.queue.length >= this.batchSize) void this.drain()
    } catch (err) {
      // Capturing an error must never itself throw into the customer's request path.
      this.log(`capture failed (${String(err)})`)
    }
  }

  private buildEvent(
    message: string, type: string, stack: string, opts: CaptureOptions,
  ): ServerEvent {
    const req: RequestContext = opts.request ?? {}
    const user: UserContext = opts.user ?? {}

    const data: Record<string, unknown> = {
      message: truncate(message, MAX_MESSAGE_CHARS),
      type,
      stack: truncate(stack, MAX_STACK_CHARS),
      handled: opts.handled ?? true,
      environment: this.environment,
      serverName: this.serverName,
      runtime: `node/${process.version.replace(/^v/, '')}`,
    }
    if (this.release) data.release = this.release
    if (opts.extra) data.extra = scrub(opts.extra)
    if (req.method) data.method = String(req.method).slice(0, 10)

    if (this.sendDefaultPii) {
      if (req.headers) data.headers = scrub(req.headers)
      if (req.query) data.query = scrub(req.query)
      if (req.ip) data.ip = req.ip
      if (user.email) data.userEmail = user.email
    }

    return {
      deviceId: this.instanceId,
      userId: user.id != null ? String(user.id).slice(0, 255) : null,
      // Empty unless the app supplies a correlation id.
      //
      // A fresh id per error made the ingest pipeline mint one Session row per exception,
      // each with a single event and zero duration — which lands in the customer's own
      // Overview and drags their average session time to nothing. The Python SDK shipped
      // that and it had to be fixed; do not reintroduce it here.
      sessionId: req.requestId ? String(req.requestId).slice(0, 255) : '',
      event: 'SERVER_ERROR',
      data,
      page: req.path ? String(req.path).slice(0, 500) : '',
      referrer: '',
      ts: Date.now(),
      platform: 'server',
    }
  }

  /** Ship whatever is queued, in batches. Returns false if any batch was rejected. */
  private async drain(): Promise<boolean> {
    if (!this.queue.length) return true
    let allOk = true
    while (this.queue.length) {
      const batch = this.queue.splice(0, this.batchSize)
      this.inFlight++
      try {
        const ok = await this.transport.send(batch)
        if (!ok) allOk = false
      } catch (err) {
        allOk = false
        this.log(`drain failed (${String(err)})`)
      } finally {
        this.inFlight--
      }
    }
    return allOk
  }

  private pruneRecent(now: number): void {
    const cutoff = now - this.dedupWindow * 1000
    for (const [k, t] of this.recent) {
      if (t < cutoff) this.recent.delete(k)
    }
    // Still oversized after pruning (every entry is fresh): drop the oldest half rather
    // than let the map grow without bound under a storm of distinct errors.
    if (this.recent.size > 500) {
      const keys = [...this.recent.keys()].slice(0, this.recent.size - 250)
      for (const k of keys) this.recent.delete(k)
    }
  }

  private log(msg: string): void {
    if (this.debug) console.log(`nohmo: ${msg}`)
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Pull message/type/stack out of anything someone might throw. */
export function describeError(err: unknown): {
  message: string; type: string; stack: string
} {
  if (err instanceof Error) {
    return {
      message: `${err.name}: ${err.message}`,
      type: err.name || 'Error',
      stack: err.stack ?? '',
    }
  }
  // JS lets you throw literals, and plenty of libraries do.
  if (typeof err === 'string') return { message: err, type: 'Error', stack: '' }
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    const msg = typeof o.message === 'string' ? o.message : safeStringify(err)
    const type = typeof o.name === 'string' ? o.name : 'Error'
    return { message: msg, type, stack: typeof o.stack === 'string' ? o.stack : '' }
  }
  return { message: String(err), type: 'Error', stack: '' }
}

/** First stack frame, used to keep same-message errors from different sites apart. */
function firstFrame(stack: string): string {
  for (const line of stack.split('\n')) {
    const t = line.trim()
    if (t.startsWith('at ')) return t.slice(0, 200)
  }
  return ''
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

function safeHostname(): string {
  try {
    return hostname() || 'unknown'
  } catch {
    return 'unknown'
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : hi
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms)
    if (typeof t.unref === 'function') t.unref()
  })
}
