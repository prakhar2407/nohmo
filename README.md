# nohmo

Official analytics SDK for [Nohmo](https://nohmo.com) — device fingerprinting, session journeys, and event batching for React and Next.js.

## Install

```bash
npm install nohmo
```

## Next.js (App Router)

In `app/layout.tsx`:

```tsx
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

`NohmoNextProvider` automatically tracks page views on every route change and records time spent on each page using `usePathname` from Next.js App Router.

## Next.js (Pages Router)

In `pages/_app.tsx`:

```tsx
import { NohmoProvider } from 'nohmo'
import { useRouter } from 'next/router'
import { useEffect } from 'react'
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

## Track events anywhere

```tsx
import { useNohmo } from 'nohmo'

export default function CarCard({ car }: { car: { id: string; price: number } }) {
  const { send } = useNohmo()

  return (
    <button onClick={() => send('car_viewed', { carId: car.id, price: car.price })}>
      View Car
    </button>
  )
}
```

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

All events tracked before `linkUser` is called are anonymously recorded and automatically associated with the user on the backend once linked.

## Plain React

```tsx
import { NohmoProvider } from 'nohmo'

function App() {
  return (
    <NohmoProvider
      projectId="proj_xxxx"
      apiKey="pk_xxxx"
    >
      <YourApp />
    </NohmoProvider>
  )
}
```

Works the same as the Next.js provider but without automatic route-change tracking. Call `send('PAGE_VIEW', { path })` manually on route changes, or use the `usePageView` hook.

## Manual page view hook

```tsx
import { usePageView } from 'nohmo'

export default function MyPage() {
  usePageView('/my-page')
  return <div>...</div>
}
```

## Environment variables

```env
NEXT_PUBLIC_NOHMO_PROJECT_ID=proj_xxxx
NEXT_PUBLIC_NOHMO_API_KEY=pk_xxxx
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `flushInterval` | `number` | `3000` | Milliseconds between batch event flushes |
| `debug` | `boolean` | `false` | Log events and state to the browser console |
| `autoPageView` | `boolean` | `true` | Auto-track page views (Next.js provider only) |
| `autoScrollDepth` | `boolean` | `true` | Auto-track scroll depth milestones (25/50/75/100%) |
| `autoTimeSpent` | `boolean` | `true` | Auto-track time spent on each page |

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

## What gets tracked automatically

| Event | Trigger |
|-------|---------|
| `PAGE_VIEW` | Every route change (Next.js) or manually |
| `TIME_SPENT` | On route change, with seconds on previous page |
| `SCROLL_DEPTH` | At 25%, 50%, 75%, and 100% scroll milestones |
| `USER_LINKED` | When `linkUser()` is called |

## How it works

1. On first load, a device fingerprint is generated via [FingerprintJS](https://github.com/fingerprintjs/fingerprintjs) and stored in `localStorage`.
2. The SDK calls `/api/tracker/identify/` on your Nohmo backend to register the device.
3. Events are queued in memory and flushed as a batch every `flushInterval` ms via `navigator.sendBeacon` (with `fetch` as fallback).
4. When the user logs in, `linkUser()` flushes all queued anonymous events and then calls `/api/tracker/link-user/` to associate the device with a real user.

## License

MIT
