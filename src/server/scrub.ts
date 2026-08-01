/**
 * Credential redaction.
 *
 * Ported deliberately from the Python SDK (nohmo_sdk/client.py) so both backend SDKs
 * redact the same things — a header that is safe in one language must not be a leak in
 * the other.
 */

/**
 * Written in whatever form reads naturally, then normalised once below.
 *
 * Comparing a normalised key against a NON-normalised set is a silent credential leak:
 * 'X-API-Key' normalises to 'x_api_key' and would never match an entry stored as
 * 'x-api-key'. That exact bug shipped in the Python SDK before review caught it.
 */
const SENSITIVE_KEY_SOURCE = [
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie',
  'x-api-key', 'api-key', 'apikey', 'x-auth-token', 'auth',
  'password', 'passwd', 'pwd', 'secret', 'token', 'access_token', 'refresh_token',
  'id_token', 'session', 'sessionid', 'session_key', 'csrfmiddlewaretoken',
  'csrf_token', 'x-csrftoken', 'private_key', 'client_secret', 'signature',
  'credit_card', 'card_number', 'cvv', 'cvc', 'ssn', 'pin', 'otp',
]

/** Fold a header/field name to one comparable form: lowercase, hyphens as underscores. */
export function normaliseKey(key: string): string {
  return key.trim().toLowerCase().replace(/-/g, '_')
}

const SENSITIVE_KEYS = new Set(SENSITIVE_KEY_SOURCE.map(normaliseKey))

/** Substrings that mark a key sensitive whatever it is wrapped in — catches
 *  'stripe_secret_key', 'user_password_hash', 'DB_PASSWORD' and friends. */
const SENSITIVE_SUBSTRINGS = [
  'secret', 'password', 'passwd', 'token', 'apikey', 'api_key', 'private_key', 'credential',
]

const REDACTED = '[redacted]'
const MAX_DEPTH = 6
const MAX_ARRAY = 50

export function isSensitive(key: string): boolean {
  const norm = normaliseKey(key)
  return SENSITIVE_KEYS.has(norm) || SENSITIVE_SUBSTRINGS.some((s) => norm.includes(s))
}

/**
 * Redact anything that looks like a credential. Key-based, case-insensitive, and
 * deliberately over-eager: over-redacting costs a little debuggability, under-redacting
 * puts someone's session token in a third-party database.
 *
 * Depth-limited so a deeply nested or self-referential object cannot hang the caller.
 * A `seen` set breaks true cycles, which are far easier to produce in JS than in Python —
 * `req.socket.parser.incoming === req` is a real cycle on a live node:http request.
 */
export function scrub(
  data: Record<string, unknown> | null | undefined,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  if (depth >= MAX_DEPTH) return { '...': '[truncated]' }
  if (seen.has(data)) return { '...': '[circular]' }
  seen.add(data)

  const out: Record<string, unknown> = {}
  for (const k of Object.keys(data)) {
    const v = (data as Record<string, unknown>)[k]
    if (isSensitive(k)) {
      out[k] = REDACTED
    } else if (Array.isArray(v)) {
      out[k] = v.slice(0, MAX_ARRAY).map((i) =>
        i && typeof i === 'object' && !Array.isArray(i)
          ? scrub(i as Record<string, unknown>, depth + 1, seen)
          : safeScalar(i),
      )
    } else if (v && typeof v === 'object') {
      out[k] = scrub(v as Record<string, unknown>, depth + 1, seen)
    } else {
      out[k] = safeScalar(v)
    }
  }
  return out
}

/**
 * Anything that is not JSON-safe becomes a string.
 *
 * JSON.stringify would throw on a BigInt and silently drop a function or undefined, so a
 * single odd value in someone's `extra` could otherwise cost the whole batch.
 */
function safeScalar(v: unknown): unknown {
  const t = typeof v
  if (v === null || t === 'string' || t === 'number' || t === 'boolean') {
    return t === 'number' && !Number.isFinite(v as number) ? String(v) : v
  }
  if (t === 'bigint') return String(v)
  if (t === 'undefined') return null
  if (t === 'function' || t === 'symbol') return `[${t}]`
  return String(v)
}
