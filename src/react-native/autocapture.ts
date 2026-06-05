type Sender = {
  send: (event: string, data: Record<string, unknown>) => void
  trackScreenView: (screenName: string) => void
}

let _sender: Sender | null = null

export function setAutoCaptureTracker(sender: Sender): void {
  _sender = sender
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
  if (!_sender) return
  const name = getActiveRouteName(state)
  if (name) _sender.trackScreenView(name)
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
    if (!_sender) return
    const route = navigationRef.current?.getCurrentRoute()
    if (route?.name) _sender.trackScreenView(route.name)
  }
}

// ── Press autocapture (injected by babel-plugin) ───────────────────────────

/**
 * Injected by the Nohmo Babel plugin around every onPress / onLongPress.
 * Fires a PRESS or LONG_PRESS event then calls the original handler.
 */
export function __nohmoWrap<T extends ((...args: unknown[]) => unknown) | null | undefined>(
  handler: T,
  meta: {
    c?: string | null  // component name
    p?: string         // prop name (onPress | onLongPress)
    t?: string | null  // static text extracted from children
    f?: string | null  // filename (without extension)
    l?: number         // line number
  }
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    if (_sender) {
      _sender.send(meta.p === 'onLongPress' ? 'LONG_PRESS' : 'PRESS', {
        component: meta.c ?? null,
        text: meta.t ?? null,
        file: meta.f ?? null,
        line: meta.l ?? null,
      })
    }
    return (handler as ((...a: unknown[]) => unknown) | null | undefined)?.(...args)
  }
}
