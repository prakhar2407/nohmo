/**
 * Public types for the Node server SDK (`nohmo/server`).
 *
 * Kept separate from src/core/types.ts on purpose: nothing here may import browser or
 * React types, because this entry point is bundled for Node with no DOM lib.
 */

export interface NohmoServerOptions {
  /** Nohmo project id, from the dashboard. */
  projectId: string
  /** Project API key. Ingest authenticates on this ALONE — the projectId routes nothing. */
  apiKey: string
  /** Override the ingest URL. Only useful for self-hosted or tests. */
  endpoint?: string
  /** Tags every event, so staging errors stay distinguishable from production ones. */
  environment?: string
  /** Ties errors to a deploy, so a spike can be attributed to a release. */
  release?: string
  /** Groups errors per host. Defaults to os.hostname(). */
  serverName?: string
  /** Fraction of errors actually sent, 0..1. Defaults to 1 (everything). */
  sampleRate?: number
  /** Seconds before an identical error is reported again. Defaults to 5. */
  dedupWindow?: number
  /** Bounded, so a crash loop cannot turn the SDK into the outage. Defaults to 1000. */
  queueSize?: number
  /** Events per request. Defaults to 50. */
  batchSize?: number
  /** Seconds before a partial batch ships. Defaults to 5. */
  flushInterval?: number
  /**
   * Attach request headers, query strings and the user's email. Off by default —
   * turning it on sends PII to Nohmo, which should be a considered decision.
   */
  sendDefaultPii?: boolean
  /** Verbose logging to the console. */
  debug?: boolean
}

/** The subset of a request worth reporting. Framework-agnostic on purpose. */
export interface RequestContext {
  path?: string
  method?: string
  /** Becomes the event's sessionId, so an error can be tied to a request trace. */
  requestId?: string
  headers?: Record<string, unknown>
  query?: Record<string, unknown>
  ip?: string
}

export interface UserContext {
  id?: string | number
  email?: string
}

export interface CaptureOptions {
  request?: RequestContext
  user?: UserContext
  /** Arbitrary extra context. Scrubbed like everything else. */
  extra?: Record<string, unknown>
  /** false when the error escaped to the framework's handler. */
  handled?: boolean
}

/** Exactly the shape the ingest endpoint expects — matches the browser SDK and nohmo-sdk (Python). */
export interface ServerEvent {
  deviceId: string
  userId: string | null
  sessionId: string
  event: 'SERVER_ERROR'
  data: Record<string, unknown>
  page: string
  referrer: string
  ts: number
  platform: 'server'
}
