/**
 * The process-wide client singleton and the functions that use it.
 *
 * Split out from index.ts so the integrations can reach captureException without
 * importing the barrel that re-exports them. Going through index.ts created a genuine
 * import cycle (index -> express -> index), which in a CJS bundle can leave the binding
 * undefined at module-init time — the integration would silently report nothing.
 */
import { ServerClient } from './client'
import type { CaptureOptions, NohmoServerOptions } from './types'

let client: ServerClient | null = null

/**
 * Kept so it can be detached again. Without this, every init() added another 'beforeExit'
 * listener and none were ever removed — Node starts printing MaxListenersExceededWarning
 * at eleven, and an app that re-inits on config reload would leak one per reload.
 */
let beforeExitHandler: (() => void) | null = null

function detachBeforeExit(): void {
  if (beforeExitHandler) {
    process.removeListener('beforeExit', beforeExitHandler)
    beforeExitHandler = null
  }
}

/**
 * Initialise the global client. Returns it, or null if configuration was missing.
 *
 * Never throws: a missing env var must not stop a deploy. It logs once and disables
 * itself, the same posture the Django integration takes.
 */
export function init(options: NohmoServerOptions): ServerClient | null {
  if (!options?.projectId || !options?.apiKey) {
    console.warn('nohmo: init() called without projectId/apiKey — disabled')
    client = null
    return null
  }
  try {
    detachBeforeExit()
    client = new ServerClient(options)
    // Best-effort final flush. 'beforeExit' does NOT fire on an explicit process.exit()
    // or a fatal signal, which is exactly why flush() is public and documented for
    // short-lived processes.
    beforeExitHandler = () => { void client?.flush(2000) }
    process.once('beforeExit', beforeExitHandler)
    return client
  } catch (err) {
    console.warn(`nohmo: init failed — disabled (${String(err)})`)
    client = null
    return null
  }
}

export function isInitialised(): boolean {
  return client !== null
}

/** Report an exception. Safe to call before init() — it is then a no-op. */
export function captureException(err: unknown, options: CaptureOptions = {}): void {
  client?.captureException(err, options)
}

/** Report a message with no exception attached. */
export function captureMessage(message: string, options: CaptureOptions = {}): void {
  client?.captureMessage(message, options)
}

/**
 * Send everything queued and wait for it.
 *
 * Call this before a short-lived process exits — a cron job, a Lambda, a one-off script.
 * Events are otherwise shipped on a timer that is deliberately unref'd, so it will not
 * hold the process open and will not get a chance to fire on the way out.
 */
export function flush(timeoutMs = 5000): Promise<boolean> {
  return client ? client.flush(timeoutMs) : Promise.resolve(true)
}

/** Flush and stop. The client accepts nothing afterwards. */
export async function close(timeoutMs = 3000): Promise<boolean> {
  detachBeforeExit()
  if (!client) return true
  const ok = await client.close(timeoutMs)
  client = null
  return ok
}

/** Escape hatch for tests and for apps that want more than one client. */
export function getClient(): ServerClient | null {
  return client
}
