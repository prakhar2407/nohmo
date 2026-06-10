type Sender = {
  send: (event: string, data: Record<string, unknown>) => void
  trackScreenView: (screenName: string) => void
}

// Store the sender on globalThis so both the react-native bundle (which inlines this module)
// and the separately-loaded autocapture bundle (imported by the Babel plugin) share one instance.
// Module-level variables don't work here because Metro/Rollup can create two separate copies.
const _g = globalThis as unknown as Record<string, unknown>
const _KEY = '__nohmo_sender__'

export function setAutoCaptureTracker(sender: Sender): void {
  _g[_KEY] = sender
}

function _getSender(): Sender | null {
  return (_g[_KEY] as Sender | undefined) ?? null
}

// ── Screen tracking ────────────────────────────────────────────────────────

function getActiveRouteName(state: any): string | undefined {
  if (!state?.routes) return undefined
  const route = state.routes[state.index ?? state.routes.length - 1]
  if (!route) return undefined
  // Nested navigators — recurse into the active child state
  if (route.state) return getActiveRouteName(route.state)
  return route.name as string
}

/**
 * Pass directly to NavigationContainer's onStateChange prop.
 * Fires SCREEN_VIEW + TIME_SPENT automatically on every navigation.
 *
 * @example
 * import { onNohmoStateChange } from 'nohmo/react-native/autocapture'
 * <NavigationContainer onStateChange={onNohmoStateChange}>
 */
export function onNohmoStateChange(state: any): void {
  const s = _getSender()
  if (!s) return
  const name = getActiveRouteName(state)
  if (name) s.trackScreenView(name)
}

/**
 * Pass to NavigationContainer's onReady prop to also capture the initial screen.
 * Requires passing your navigationRef so the current route can be read.
 *
 * @example
 * import { onNohmoStateChange, makeNohmoReadyHandler } from 'nohmo/react-native/autocapture'
 * <NavigationContainer
 *   onStateChange={onNohmoStateChange}
 *   onReady={makeNohmoReadyHandler(navigationRef)}
 * >
 */
export function makeNohmoReadyHandler(
  navigationRef: { current: { getCurrentRoute: () => { name: string } | undefined } | null }
): () => void {
  return () => {
    const s = _getSender()
    if (!s) return
    const route = navigationRef.current?.getCurrentRoute()
    if (route?.name) s.trackScreenView(route.name)
  }
}

// ── Press autocapture (injected by babel-plugin) ───────────────────────────

/**
 * Coerce a captured label to clean text. A dynamic label expression can resolve
 * at runtime to a React element or object (e.g. `label={icon}`, or a template
 * fragment that is itself an element) — `String()` would turn that into the
 * useless "[object Object]". So: drop non-string/object values entirely, and
 * strip any "[object Object]" that leaked into an otherwise-good string before
 * trimming and capping. Returns null when nothing meaningful remains.
 */
function _coerceLabel(v: unknown): string | null {
  let s: string
  if (typeof v === 'string') s = v
  else if (typeof v === 'number' || typeof v === 'boolean') s = String(v)
  else return null // null/undefined, objects, React elements, arrays, functions
  s = s.replace(/\[object Object\]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return s || null
}

// Marks a function as already wrapped, so nested wraps can de-duplicate.
const _WRAPPED = '__nohmoWrapped__'

/**
 * Injected by the Nohmo Babel plugin around every onPress / onLongPress.
 * Fires a PRESS or LONG_PRESS event then calls the original handler.
 *
 * De-duplication: design-system buttons (e.g. <Button> → internal <Pressable
 * onPress={onPress}/>) thread the app's handler down, so the plugin wraps the
 * SAME handler at two levels. To avoid a double press (and the inner component's
 * "[object Object]" label), a wrapper whose handler is ITSELF a wrapper stays
 * silent — the app-level wrapper it delegates to carries the real label.
 */
export function __nohmoWrap<T extends ((...args: unknown[]) => unknown) | null | undefined>(
  handler: T,
  meta: {
    c?: string | null  // component name
    p?: string         // prop name (onPress | onLongPress)
    t?: unknown        // text — static (children/prop) or a runtime prop value
    f?: string | null  // filename (without extension)
    l?: number         // line number
  }
): (...args: unknown[]) => unknown {
  const wrapped = (...args: unknown[]) => {
    const s = _getSender()
    const handlerIsWrapped =
      typeof handler === 'function' && (handler as unknown as Record<string, unknown>)[_WRAPPED] === true
    if (s && !handlerIsWrapped) {
      s.send(meta.p === 'onLongPress' ? 'LONG_PRESS' : 'PRESS', {
        component: meta.c ?? null,
        text: _coerceLabel(meta.t),
        file: meta.f ?? null,
        line: meta.l ?? null,
      })
    }
    return (handler as ((...a: unknown[]) => unknown) | null | undefined)?.(...args)
  }
  ;(wrapped as unknown as Record<string, unknown>)[_WRAPPED] = true
  return wrapped
}
