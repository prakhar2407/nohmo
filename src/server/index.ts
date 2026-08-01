/**
 * Nohmo server SDK for Node — `nohmo/server`.
 *
 * Backend exceptions land in the same Nohmo project as the frontend's, so a 500 in an API
 * sits next to the JS error it caused in the browser.
 *
 * Deliberately dependency-free and built only against node: built-ins. An error reporter
 * that drags dependencies into someone's app is a liability — it can conflict with their
 * pinned versions and, worse, be the thing that breaks the app it exists to observe.
 *
 * This file is a barrel and nothing else. The singleton lives in global.ts so the
 * integrations can use it without importing this module back (see the note there).
 */
export { DEFAULT_ENDPOINT, ServerClient } from './client'
export {
  init, isInitialised, captureException, captureMessage, flush, close, getClient,
} from './global'
export type {
  NohmoServerOptions, CaptureOptions, RequestContext, UserContext, ServerEvent,
} from './types'
export {
  expressErrorHandler, requestContext, userContext,
} from './integrations/express'
export type { ExpressHandlerOptions } from './integrations/express'
export { wrapHandler, httpRequestContext } from './integrations/http'
