import FingerprintJS from '@fingerprintjs/fingerprintjs'

let cachedDeviceId: string | null = null

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId

  const stored = localStorage.getItem('_nohmo_did')
  if (stored) {
    cachedDeviceId = stored
    return stored
  }

  const fp = await FingerprintJS.load()
  const result = await fp.get()
  const deviceId = result.visitorId

  localStorage.setItem('_nohmo_did', deviceId)
  cachedDeviceId = deviceId
  return deviceId
}
