let cachedDeviceId: string | null = null
let cachedStableId: string | null = null

function getCanvasFingerprint(): string {
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''

    canvas.width = 200
    canvas.height = 50
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#f60'
    ctx.fillRect(125, 1, 62, 20)
    ctx.fillStyle = '#069'
    ctx.font = '11pt Arial'
    ctx.fillText('Nohmo fingerprint', 2, 15)
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)'
    ctx.font = '18pt Arial'
    ctx.fillText('Nohmo fingerprint', 4, 45)

    return canvas.toDataURL()
  } catch {
    return ''
  }
}

function getWebGLInfo(): string {
  try {
    const canvas = document.createElement('canvas')
    const gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
    if (!gl) return ''

    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    if (!ext) return ''

    const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string
    const vendor = gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) as string
    return `${renderer}~${vendor}`
  } catch {
    return ''
  }
}

function stableSignals(): string {
  const nav = navigator
  const scr = screen
  return [
    nav.userAgent,
    nav.language,
    nav.platform,
    String(nav.hardwareConcurrency ?? ''),
    String((nav as unknown as Record<string, unknown>)['deviceMemory'] ?? ''),
    String(nav.maxTouchPoints ?? ''),
    String(scr.width),
    String(scr.height),
    String(scr.colorDepth),
    String(window.devicePixelRatio ?? ''),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  ].join('|')
}

async function hash(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function getStableId(): Promise<string> {
  if (cachedStableId) return cachedStableId

  const stored = localStorage.getItem('_nohmo_sid')
  if (stored) {
    cachedStableId = stored
    return stored
  }

  const id = await hash(stableSignals())
  localStorage.setItem('_nohmo_sid', id)
  cachedStableId = id
  return id
}

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId

  const stored = localStorage.getItem('_nohmo_did')
  if (stored) {
    cachedDeviceId = stored
    return stored
  }

  const id = await hash(stableSignals() + '|' + getCanvasFingerprint() + '|' + getWebGLInfo())
  localStorage.setItem('_nohmo_did', id)
  cachedDeviceId = id
  return id
}
