// Browser IIFE entry point — zero React dependency.
// Loaded via <script> tag; reads config from data-project / data-api-key attributes.

import { NohmoTracker } from './core/tracker'

declare global {
  interface Window {
    nohmo: {
      send: (event: string, data?: Record<string, unknown>) => void
      identify: (userId: string, email?: string, meta?: Record<string, unknown>) => void
    }
  }
}

;(function () {
  const script = document.currentScript as HTMLScriptElement | null
  const projectId = script?.getAttribute('data-project') ?? ''
  const apiKey = script?.getAttribute('data-api-key') ?? ''

  if (!projectId || !apiKey) {
    console.warn('[Nohmo] Missing data-project or data-api-key on <script> tag.')
    return
  }

  const tracker = new NohmoTracker({ projectId, apiKey })
  tracker.init()

  window.nohmo = {
    send: (event, data = {}) => tracker.send(event, data),
    identify: (userId, email, meta) => void tracker.linkUser(userId, email, meta),
  }
})()
