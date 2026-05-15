export interface UTMParams {
  source?: string
  medium?: string
  campaign?: string
  term?: string
  content?: string
}

export function getUTMParams(): UTMParams {
  if (typeof window === 'undefined') return {}

  const params = new URLSearchParams(window.location.search)
  const fromUrl: UTMParams = {}

  const s  = params.get('utm_source')
  const m  = params.get('utm_medium')
  const c  = params.get('utm_campaign')
  const t  = params.get('utm_term')
  const co = params.get('utm_content')

  if (s)  fromUrl.source   = s
  if (m)  fromUrl.medium   = m
  if (c)  fromUrl.campaign = c
  if (t)  fromUrl.term     = t
  if (co) fromUrl.content  = co

  // Current URL has UTM — persist for the rest of this session
  if (Object.keys(fromUrl).length > 0) {
    try { sessionStorage.setItem('_nohmo_utm', JSON.stringify(fromUrl)) } catch {}
    return fromUrl
  }

  // No UTM on this page — use what was captured on the landing page
  try {
    const stored = sessionStorage.getItem('_nohmo_utm')
    if (stored) return JSON.parse(stored) as UTMParams
  } catch {}

  return {}
}
