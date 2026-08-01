/**
 * Raw node:http integration — the catch-all for anything without a dedicated adapter.
 *
 *     import { init, wrapHandler } from 'nohmo/server'
 *
 *     init({ projectId: '...', apiKey: process.env.NOHMO_API_KEY })
 *     http.createServer(wrapHandler(async (req, res) => { ... })).listen(3000)
 *
 * This is the Node counterpart of the Python SDK's WSGI wrapper: it works with Connect,
 * Koa's raw layer, Next's custom server, or a hand-rolled http server.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { captureException } from '../global'
import type { RequestContext } from '../types'

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

export function httpRequestContext(req: IncomingMessage): RequestContext {
  const url = req.url ?? ''
  const qi = url.indexOf('?')
  return {
    path: qi === -1 ? url : url.slice(0, qi),
    method: req.method,
    headers: req.headers as Record<string, unknown>,
    query: qi === -1 ? undefined : parseQuery(url.slice(qi + 1)),
    ip: req.socket?.remoteAddress,
    requestId: headerValue(req, 'x-request-id') ?? headerValue(req, 'x-correlation-id'),
  }
}

/**
 * Wrap a handler so anything it throws — synchronously or from a rejected promise — is
 * reported and then rethrown.
 *
 * Rethrowing matters: swallowing here would leave the socket hanging open forever with no
 * response, turning an error the app could have handled into a stalled request.
 */
export function wrapHandler(handler: Handler): Handler {
  return function nohmoWrapped(req: IncomingMessage, res: ServerResponse) {
    const report = (err: unknown) => {
      try {
        captureException(err, { request: httpRequestContext(req), handled: false })
      } catch {
        /* never replace the app's error with ours */
      }
    }
    try {
      const out = handler(req, res)
      // Only attach a catch when the handler is actually thenable — a sync handler
      // returning undefined must not be coerced into a promise.
      if (out && typeof (out as Promise<void>).then === 'function') {
        return (out as Promise<void>).catch((err: unknown) => {
          report(err)
          throw err
        })
      }
      return out
    } catch (err) {
      report(err)
      throw err
    }
  }
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name]
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' && s ? s : undefined
}

function parseQuery(qs: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const pair of qs.split('&')) {
    if (!pair) continue
    const i = pair.indexOf('=')
    const k = i === -1 ? pair : pair.slice(0, i)
    const v = i === -1 ? '' : pair.slice(i + 1)
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v)
    } catch {
      out[k] = v      // malformed percent-encoding: keep it raw rather than throw
    }
  }
  return out
}
