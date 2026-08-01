/**
 * Express integration.
 *
 *     import { init, expressErrorHandler } from 'nohmo/server'
 *
 *     init({ projectId: '...', apiKey: process.env.NOHMO_API_KEY })
 *
 *     app.get('/', handler)
 *     // ... all routes ...
 *     app.use(expressErrorHandler())   // LAST, after every route and router
 *
 * Placement is the opposite of the Django middleware's. Express error handlers only see
 * errors from middleware registered BEFORE them, so this goes last; Django's
 * process_exception hook sees what is below it, so that one goes first.
 */
import { captureException } from '../global'
import type { RequestContext, UserContext } from '../types'

/** Structurally typed so the SDK never needs @types/express as a dependency. */
interface ReqLike {
  path?: string
  originalUrl?: string
  url?: string
  method?: string
  headers?: Record<string, unknown>
  query?: Record<string, unknown>
  ip?: string
  user?: unknown
  id?: unknown
}
type NextLike = (err?: unknown) => void

export interface ExpressHandlerOptions {
  /**
   * Decide whether an error is worth reporting. Return false to skip.
   * Handy for 404s or validation errors that are expected traffic, not defects.
   */
  shouldReport?: (err: unknown, req: unknown) => boolean
}

export function requestContext(req: ReqLike): RequestContext {
  return {
    // originalUrl keeps the mount prefix a router strips off req.url, which is what
    // makes the reported path match the route the user actually hit.
    path: stripQuery(req.originalUrl || req.path || req.url || ''),
    method: req.method,
    headers: req.headers,
    query: req.query,
    ip: req.ip,
    // Set by common request-id middleware; becomes the event's sessionId so an error can
    // be tied back to a request trace.
    requestId: pickRequestId(req),
  }
}

export function userContext(req: ReqLike): UserContext | undefined {
  const u = req.user as Record<string, unknown> | undefined
  if (!u || typeof u !== 'object') return undefined
  const id = u.id ?? u._id ?? u.userId ?? u.sub
  const email = typeof u.email === 'string' ? u.email : undefined
  if (id == null && !email) return undefined
  return { id: id as string | number | undefined, email }
}

/**
 * Express error-handling middleware. Reports, then hands the error straight on — it never
 * swallows, so the app's own error page or JSON response is unchanged.
 */
export function expressErrorHandler(options: ExpressHandlerOptions = {}) {
  // Express identifies error handlers by arity: it MUST declare four parameters, so
  // `_next` cannot be removed even though renaming it would satisfy a linter.
  return function nohmoErrorHandler(
    err: unknown, req: ReqLike, _res: unknown, next: NextLike,
  ): void {
    try {
      if (!options.shouldReport || options.shouldReport(err, req)) {
        captureException(err, {
          request: requestContext(req),
          user: userContext(req),
          handled: false,
        })
      }
    } catch {
      // Reporting must never replace the customer's error with one of ours.
    }
    next(err)
  }
}

function stripQuery(url: string): string {
  const i = url.indexOf('?')
  return i === -1 ? url : url.slice(0, i)
}

function pickRequestId(req: ReqLike): string | undefined {
  if (typeof req.id === 'string' && req.id) return req.id
  const h = req.headers ?? {}
  for (const key of ['x-request-id', 'x-correlation-id', 'x-amzn-trace-id']) {
    const v = h[key]
    const s = Array.isArray(v) ? v[0] : v
    if (typeof s === 'string' && s) return s
  }
  return undefined
}
