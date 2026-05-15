# nohmo

Official analytics SDK for [Nohmo](https://www.nohmo.in) — device tracking, session journeys, UTM attribution, and real-time event streaming for React and Next.js.

## Install

```bash
npm install nohmo
```

## Quick start

### Next.js (App Router)

```tsx
// app/layout.tsx
import { NohmoNextProvider } from 'nohmo'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <NohmoNextProvider
          projectId={process.env.NEXT_PUBLIC_NOHMO_PROJECT_ID!}
          apiKey={process.env.NEXT_PUBLIC_NOHMO_API_KEY!}
        >
          {children}
        </NohmoNextProvider>
      </body>
    </html>
  )
}
```

Page views, time spent, scroll depth, and clicks are tracked automatically from this point.

```env
NEXT_PUBLIC_NOHMO_PROJECT_ID=proj_xxxx
NEXT_PUBLIC_NOHMO_API_KEY=pk_xxxx
```

### Next.js (Pages Router)

```tsx
// pages/_app.tsx
import { NohmoProvider } from 'nohmo'
import type { AppProps } from 'next/app'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <NohmoProvider
      projectId={process.env.NEXT_PUBLIC_NOHMO_PROJECT_ID!}
      apiKey={process.env.NEXT_PUBLIC_NOHMO_API_KEY!}
    >
      <Component {...pageProps} />
    </NohmoProvider>
  )
}
```

### Plain React (Vite, CRA)

```tsx
import { NohmoProvider } from 'nohmo'

function App() {
  return (
    <NohmoProvider projectId="proj_xxxx" apiKey="pk_xxxx">
      <YourApp />
    </NohmoProvider>
  )
}
```

No automatic route-change tracking — use `usePageView('/path')` in each page component or call `send('PAGE_VIEW', …)` manually on route changes.

---

## Track custom events

```tsx
import { useNohmo } from 'nohmo'

export default function BuyButton({ item }: { item: { id: string; price: number } }) {
  const { send } = useNohmo()

  return (
    <button onClick={() => send('purchase_started', { itemId: item.id, price: item.price })}>
      Buy now
    </button>
  )
}
```

Events are queued in memory and flushed as a batch every `flushInterval` ms via `navigator.sendBeacon` (falling back to `fetch`). They survive page unload and never block the main thread.

## Identify users after login

```tsx
import { useNohmo } from 'nohmo'

export default function LoginForm() {
  const { linkUser } = useNohmo()

  const handleLogin = async () => {
    const user = await loginAPI()
    await linkUser(user.id, user.email, { plan: user.plan })
  }

  return <button onClick={handleLogin}>Login</button>
}
```

Every event fired before `linkUser()` — including across previous sessions — is retroactively attached to the user on the backend. Nothing is lost.

Once a user is linked, their identity persists. If they visit from a different device and call `linkUser()` again with the same ID, their profile and metadata are automatically merged.

## Manual page view hook

```tsx
import { usePageView } from 'nohmo'

export default function MyPage() {
  usePageView('/my-page') // fires PAGE_VIEW once on mount
  return <div>…</div>
}
```

---

## What gets tracked automatically

| Event | Trigger | Data |
|-------|---------|------|
| `PAGE_VIEW` | Every route change (Next.js) or `usePageView()` | `page`, `referrer` |
| `TIME_SPENT` | When navigating away from a page | `seconds` |
| `SCROLL_DEPTH` | At 25 / 50 / 75 / 100% scroll milestones | `depth` |
| `CLICK` | Click on any interactive element | `tag`, `text`, `href` |
| `RAGE_CLICK` | Three or more rapid clicks in the same spot | `tag`, `text` |
| `USER_LINKED` | When `linkUser()` is called | `email` |

Disable any category via the `options` prop.

## UTM attribution

UTM parameters are captured automatically on the first page load of each session and sent with every subsequent event. No extra code needed.

```
https://yourapp.com?utm_source=google&utm_medium=cpc&utm_campaign=spring-sale
```

Supported parameters: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`.

Parameters are stored in `sessionStorage` so they persist across SPA navigations even when the user lands on a clean URL. Attribution is first-touch per session. Results appear in the **Traffic** dashboard.

---

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `flushInterval` | `number` | `3000` | Milliseconds between batch event flushes |
| `debug` | `boolean` | `false` | Log all events and state to the browser console |
| `autoPageView` | `boolean` | `true` | Send `PAGE_VIEW` on every route change (Next.js only) |
| `autoScrollDepth` | `boolean` | `true` | Track scroll depth at 25 / 50 / 75 / 100% |
| `autoTimeSpent` | `boolean` | `true` | Send `TIME_SPENT` when leaving a page |
| `autoCapture` | `boolean` | `true` | Capture clicks automatically |

```tsx
<NohmoNextProvider
  projectId="..."
  apiKey="..."
  options={{
    flushInterval: 5000,
    debug: true,
    autoScrollDepth: false,
  }}
>
  {children}
</NohmoNextProvider>
```

---

## What the dashboard shows

| Dashboard page | What you get |
|----------------|-------------|
| **Overview** | Event volume chart, unique devices, sessions, avg time spent, top pages |
| **Devices** | Every device with browser, OS, screen size, timezone, country, city, last seen, pages visited |
| **Device journey** | Full chronological event history per device, grouped by session |
| **Live feed** | Real-time event stream via WebSocket — see who is on your site right now |
| **Traffic** | Session breakdown by UTM source, medium, and campaign |
| **Journeys** | All sessions across all devices, sortable by recency |

## How it works

1. On first load, a 128-bit random device ID is generated via the Web Crypto API and stored in `localStorage`. Subsequent visits on the same browser reuse it.
2. The SDK registers the device with the Nohmo backend, recording browser, OS, screen resolution, timezone, and language. The backend resolves GeoIP location from the request IP.
3. UTM parameters are read from the URL and stored in `sessionStorage` for the duration of the session.
4. Events are queued locally and flushed in batches via `navigator.sendBeacon`. Each event carries the device ID, session ID, page, timestamp, and any UTM context.
5. When `linkUser()` is called, the device is associated with a real user identity server-side. All prior anonymous events are attributed to that user retroactively.

## Pricing

| Plan | Price | Events |
|------|-------|--------|
| Starter | Free | 50k/month |
| Pro | $29/month | 500k/month |
| Business | $79/month | 5M/month |

[See full pricing →](https://www.nohmo.in/pricing)

## License

MIT
