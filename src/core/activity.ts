// Shared "the app did something" signal.
//
// Dead-click detection needs to know whether a click caused any work at all. DOM
// mutations and navigations are observable from AutoCapture directly, but network
// requests are not — and "clicked, fired a request, request came back empty" is one of
// the most common silent failures there is.
//
// ErrorCapture already wraps fetch and XHR to catch failures, so it records every
// request here as it passes. Keeping the signal in a module-level singleton means we
// wrap the network stack exactly once: a second patch layered on top would make
// teardown order-dependent and could leave a wrapped fetch behind after destroy().

let lastNetworkAt = 0

/** Called by ErrorCapture on every outbound request (not just failed ones). */
export function markNetworkActivity(): void {
  lastNetworkAt = Date.now()
}

/**
 * Whether any request has been issued at or after `since` (a Date.now() value).
 *
 * The comparison is `>=`, not `>`, and that matters: a click handler that calls fetch()
 * synchronously records its timestamp in the SAME millisecond the click was captured.
 * With a strict `>` that request would not count, and a perfectly working button that
 * fires exactly one request would be reported as a dead click.
 */
export function hadNetworkActivitySince(since: number): boolean {
  return lastNetworkAt >= since
}
