export interface UTMParams {
  source?: string
  medium?: string
  campaign?: string
  term?: string
  content?: string
  _custom?: boolean
}

const DEFAULT_ATTRIBUTION_PARAMS = ['ref']

export function getUTMParams(attributionParams: string[] = DEFAULT_ATTRIBUTION_PARAMS): UTMParams {
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

  // No utm_* params — walk the custom attribution list and use the first match.
  // source = the param value, medium = the param name so it's identifiable in
  // the dashboard (e.g. ?reference=META_ADS_1 → source="META_ADS_1", medium="reference").
  if (Object.keys(fromUrl).length === 0) {
    for (const name of attributionParams) {
      const val = params.get(name)
      if (val) {
        fromUrl.source = val
        fromUrl.medium = name
        fromUrl._custom = true
        break
      }
    }
  }

  // Current URL has attribution — persist for the rest of this session
  if (Object.keys(fromUrl).length > 0) {
    try { sessionStorage.setItem('_nohmo_utm', JSON.stringify(fromUrl)) } catch {}
    return fromUrl
  }

  // No attribution on this page — use what was captured on the landing page
  try {
    const stored = sessionStorage.getItem('_nohmo_utm')
    if (stored) return JSON.parse(stored) as UTMParams
  } catch {}

  return {}
}
