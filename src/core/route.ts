/**
 * Route-change detection that does not depend on any router.
 *
 * This exists because the Next provider used to `import { usePathname } from
 * 'next/navigation'`. That import is static and lives in the main bundle, so ANY consumer
 * of the package — a Vite app, a CRA app, a plain Node script — had to be able to resolve
 * `next/navigation` just to import `nohmo`. They cannot, and the install failed with
 * "Cannot find module 'next/navigation'". A whole documented platform was broken by one
 * import that only one framework needs.
 *
 * Watching the History API instead covers every client-side router, Next's App Router
 * included: its soft navigations go through history.pushState like everyone else's.
 */

type Listener = (path: string) => void

const listeners = new Set<Listener>()
let patched = false

export function currentPath(): string {
  return typeof window === 'undefined' ? '' : window.location.pathname
}

function notify(): void {
  const path = currentPath()
  // Copy first: a listener may unsubscribe itself while we are iterating.
  for (const l of [...listeners]) {
    try {
      l(path)
    } catch {
      // One bad subscriber must not stop the others, and must never surface as an app error.
    }
  }
}

/**
 * Patch history once, for the lifetime of the page.
 *
 * Deliberately never un-patched. Restoring the originals when the last listener leaves
 * would clobber any other library that patched on top of ours in the meantime — the
 * classic monkey-patch teardown bug. The patch is idempotent and costs one function call
 * per navigation, so leaving it is the safer trade.
 */
function ensurePatched(): void {
  if (patched || typeof window === 'undefined' || typeof history === 'undefined') return
  patched = true

  const origPush = history.pushState
  const origReplace = history.replaceState

  history.pushState = function patchedPushState(...args: Parameters<typeof origPush>) {
    const ret = origPush.apply(this, args)
    // After the call, so location.pathname already reflects the new route.
    notify()
    return ret
  }
  history.replaceState = function patchedReplaceState(...args: Parameters<typeof origReplace>) {
    const ret = origReplace.apply(this, args)
    notify()
    return ret
  }

  // Back/forward buttons do not go through pushState.
  window.addEventListener('popstate', notify)
}

/** Subscribe to route changes. Returns an unsubscribe function. */
export function onRouteChange(listener: Listener): () => void {
  if (typeof window === 'undefined') return () => {}
  ensurePatched()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
