# nohmo

Official analytics SDK for [Nohmo](https://www.nohmo.in) — device tracking, session journeys, UTM attribution, and real-time event streaming for React, Next.js, and plain HTML / Django templates.

## Install

```bash
# Web (React / Next.js)
npm install nohmo

# React Native (iOS & Android)
npm install nohmo

# Optional — recommended for persisting device identity across app restarts
npm install @react-native-async-storage/async-storage
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

### Plain HTML / Django templates (no build step)

Add one script tag. No npm, no bundler, no build step required.

```html
<!-- In your <head> or before </body> -->
<script
  src="https://cdn.jsdelivr.net/npm/nohmo@latest/dist/n.min.js"
  data-project="proj_xxxx"
  data-api-key="pk_xxxx"
  defer
></script>
```

That's it. Page views, clicks, scroll depth, time spent, and rage-clicks are tracked automatically the moment the script loads.

**Track custom events from any inline script:**

```html
<button onclick="window.nohmo.send('signup_clicked', { plan: 'pro' })">
  Sign up
</button>
```

**Identify users (e.g. in a Django template after login):**

```html
{% if user.is_authenticated %}
<script>
  window.nohmo.identify('{{ user.pk }}', '{{ user.email }}')
</script>
{% endif %}
```

`window.nohmo` is available as soon as the script finishes loading (`defer` guarantees it runs after the DOM is ready). For inline scripts that run before the page finishes loading, use `window.addEventListener('load', () => { window.nohmo.send(...) })`.

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

## React Native (iOS & Android)

Nohmo includes a first-party React Native SDK under `nohmo/react-native`. One package, two platforms.

### Setup

```bash
npm install nohmo
```

The SDK works out of the box with no additional dependencies. Device identity is kept in memory by default — meaning a new device ID is generated on every app restart. To persist the device ID across restarts (recommended), install `@react-native-async-storage/async-storage` and pass it via the `storage` option:

```bash
npm install @react-native-async-storage/async-storage
```

```tsx
// App.tsx
import { NohmoProvider } from 'nohmo/react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

export default function App() {
  return (
    <NohmoProvider
      projectId="proj_xxxx"
      apiKey="pk_xxxx"
      options={{ appVersion: '1.0.0', debug: __DEV__, storage: AsyncStorage }}
    >
      <YourApp />
    </NohmoProvider>
  )
}
```

If you skip `storage`, everything works — events are tracked, screens are recorded, users can be identified — you just won't get returning-device recognition after an app kill.

### What gets tracked automatically

| Event | Trigger |
|-------|---------|
| `APP_INSTALL` | First time the app ever opens |
| `APP_OPEN` | Every time the app becomes active |
| `APP_BACKGROUND` | When the app goes to background, with session duration |

### Track screens automatically

The Babel plugin handles this too — no prop changes needed. It detects `<NavigationContainer>` in your JSX and injects `onStateChange` and `onReady` at compile time:

```jsx
// You write this (unchanged):
<NavigationContainer ref={navigationRef} theme={navigationTheme}>
  <RootNavigator />
</NavigationContainer>

// Plugin compiles it to:
<NavigationContainer
  ref={navigationRef}
  theme={navigationTheme}
  onStateChange={__nohmoNavStateChange}
  onReady={__nohmoMakeReady(navigationRef)}
>
  <RootNavigator />
</NavigationContainer>
```

Everything is driven by the single `plugins: ['nohmo/babel-plugin']` line in `babel.config.js`. No manual prop wiring.

**Manual tracking** — if you prefer per-screen control without the plugin:

```tsx
import { useScreenView } from 'nohmo/react-native'

export default function HomeScreen() {
  useScreenView('Home')   // fires SCREEN_VIEW on mount
  return <View>…</View>
}
```

### Custom events

```tsx
const { send } = useNohmo()

send('button_tapped', { buttonId: 'cta_signup' })
send('checkout_started', { cartValue: 49.99 })
```

### Identify users

```tsx
const { linkUser } = useNohmo()

// After login
await linkUser(user.id, user.email, { plan: user.plan })
```

### Track conversions

```tsx
const { trackConversion } = useNohmo()

trackConversion('user_created')
trackConversion('purchase', { amount: 29.99, currency: 'USD' })
```

### Uninstall detection

Nohmo detects app uninstalls using the same silent-push technique used by AppsFlyer and Adjust.

**1. Upload your Firebase Service Account JSON** in **Settings → App** in your Nohmo dashboard.

**2. Install Firebase Messaging:**
```bash
npm install @react-native-firebase/app @react-native-firebase/messaging
```

**3. Register the push token — one component, zero ongoing maintenance:**
```tsx
import { useNohmo } from 'nohmo/react-native'
import messaging from '@react-native-firebase/messaging'

function PushTokenRegistrar() {
  const { registerPushToken } = useNohmo()

  useEffect(() => {
    messaging().getToken().then(registerPushToken)
    return messaging().onTokenRefresh(registerPushToken) // handles token rotation
  }, [])

  return null
}
```

**How it works:**
- Every night at **03:00 UTC**, Nohmo sends a silent data-only FCM message to every device that hasn't opened the app in 24h
- If FCM returns `NotRegistered` → app was uninstalled → device is marked automatically
- No code needed after the one-time setup
- Results in **App Analytics → Uninstalls** with daily chart, uninstall rate, and D1/D7/D30 retention

**Accuracy:** ~85–90% — users with push notifications disabled cannot be detected (same limitation as every major analytics SDK).

### React Native options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `appVersion` | `string` | `''` | App version string sent with every event |
| `flushInterval` | `number` | `5000` | Milliseconds between batch event flushes |
| `debug` | `boolean` | `false` | Log all SDK activity to the console |
| `autoAppLifecycle` | `boolean` | `true` | Auto-track `APP_OPEN` and `APP_BACKGROUND` on foreground/background transitions |
| `storage` | `NohmoStorage` | in-memory | Provide an AsyncStorage-compatible object to persist device identity across app restarts. Pass `AsyncStorage` from `@react-native-async-storage/async-storage`. Without this, a new device ID is generated on every cold start. |

### Autocapture (press events)

Add one line to your Babel config and every `onPress` / `onLongPress` in your app is tracked automatically — no code changes per screen.

```js
// babel.config.js
module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: ['nohmo/babel-plugin'],  // ← add this
}
```

That's it. The plugin rewrites this at build time:

```jsx
// What you write
<Pressable onPress={handleBuy}>
  <Text>Buy now</Text>
</Pressable>
```

```jsx
// What gets compiled (you never see this)
<Pressable onPress={__nohmoWrap(handleBuy, { c: 'Pressable', t: 'Buy now', f: 'CheckoutScreen', l: 42 })}>
  <Text>Buy now</Text>
</Pressable>
```

**What gets captured automatically:**

| Event | Trigger |
|-------|---------|
| `PRESS` | Any `onPress` tap |
| `LONG_PRESS` | Any `onLongPress` |

Each event includes `component` (e.g. `Pressable`), `text` (button label if it's a static string), `file`, and `line`.

**What it doesn't capture:** dynamic text from variables/state, `onPressIn`/`onPressOut` (intentionally excluded — too noisy), or press handlers inside `node_modules`.

### Attribution via deep links

Pass UTM params in your deep link URL and the SDK captures them automatically:

```
yourapp://open?utm_source=meta&utm_medium=cpc&utm_campaign=summer
```

Attribution appears in **Traffic → Conversions** and is linked to every event in that session.

---

## Track conversions

Conversions let you measure what matters — signups, deposits, purchases — and see exactly which traffic source (Google Ads, Meta Ads, organic, etc.) drove each one.

### 1. Define goals in the dashboard

Go to **Settings → Conversions** and create a goal. Each goal has a human-readable name and a slug you reference in code:

| Name | Slug |
|------|------|
| User Created | `user_created` |
| Money Deposit | `money_deposit` |
| Subscription Started | `subscription_started` |

### 2. Call `trackConversion()` in your code

```tsx
import { useNohmo } from 'nohmo'

export default function SignupSuccess() {
  const { trackConversion } = useNohmo()

  useEffect(() => {
    trackConversion('user_created')
  }, [])
}
```

Pass optional properties for richer data:

```tsx
trackConversion('money_deposit', { amount: 500, currency: 'USD' })
```

**Plain HTML / Django templates:**

```html
<script>
  window.nohmo.conversion('money_deposit', { amount: 500 })
</script>
```

### 3. See results in Traffic → Conversions

The **Traffic** page has a **Conversions** tab showing total conversions broken down by UTM source, medium, campaign, and custom attribution parameters. Filter by a specific goal to drill into which channels drive that conversion type.

Attribution is automatic — if the user arrived via `?utm_source=google&utm_medium=cpc`, that conversion is attributed to Google CPC with no extra code.

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

### Custom attribution parameters

Not everyone uses full UTM strings. Nohmo lets you define short custom parameter names (e.g. `?ref=`, `?from=`, `?via=`) that are treated as attribution when no standard `utm_*` params are present.

**Configure in the dashboard** — go to **Settings → General → Attribution parameters** and add the parameter names you want to track. Changes take effect on the next page load; no code change or SDK rebuild needed.

```
# Examples of URLs that will be attributed automatically
https://yourapp.com?ref=meta_ads          → source: meta_ads, medium: ref
https://yourapp.com?from=newsletter       → source: newsletter, medium: from
https://yourapp.com?via=partner_site      → source: partner_site, medium: via
```

The SDK fetches your configured list from the backend when it initialises, so the same configuration works across every framework (Next.js, React, plain HTML, Django templates) without any local config.

`?ref=` is always supported as a built-in default, even before you add anything in the dashboard.

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
| **Traffic → Attribution** | Session breakdown by UTM source, medium, and campaign |
| **Traffic → Conversions** | Conversion counts by goal, source, medium, campaign — shows which ads drove results |
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
