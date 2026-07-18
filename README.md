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

# Recommended — persists device identity across app restarts
npm install @react-native-async-storage/async-storage
```

The SDK works out of the box with no additional dependencies. Without `@react-native-async-storage/async-storage` a new device ID is generated on every cold start.

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
| `TIME_SPENT` | When leaving a screen or backgrounding the app, with seconds on the screen |
| `JS_ERROR` | A non-fatal JS error caught by the global handler, with message + stack |
| `APP_CRASH` | A fatal JS crash — persisted and reported on the next app launch, attributed to the session it happened in |
| `INSTALL_ATTRIBUTED` | Attribution resolved on first open — Play Store referrer on Android, system pasteboard on iOS (built-in, no extra packages) |

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
| `autoErrors` | `boolean` | `true` | Capture JS errors (`JS_ERROR`) and crashes (`APP_CRASH`) — including native Android/iOS crashes |
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

### Install attribution (Android + iOS)

Nohmo uses the same deterministic attribution mechanism as AppsFlyer and Adjust. On Android, a click UUID is embedded in the Play Store referrer param. On iOS, the click-link interstitial writes the UUID to the system pasteboard, which the SDK reads on first open. No GAID or fingerprinting required on either platform.

**How it works end-to-end:**

1. **Build a tracking link** in **Settings → App → Attribution Link Builder** in your Nohmo dashboard. Fill in your UTM fields and copy the generated link:
   ```
   https://www.nohmo.in/api/click/<project-code>/?utm_source=facebook&utm_medium=cpc&utm_campaign=summer
   ```
   Click **Save & shorten** to store the link and get a tidy short URL (`https://www.nohmo.in/api/l/<code>`) you can reuse from the **Saved links** list.

2. **Use the link in your ad.** When a user clicks it, Nohmo records the click and routes them to the correct store:
   - **Android:** redirects to your Play Store URL with the click UUID in the referrer param — Google Play delivers this to the app on first open.
   - **iOS:** serves a brief interstitial page that writes the click UUID to the system pasteboard, then redirects to your App Store URL — the SDK reads and clears it on first open.

3. **No extra setup needed.** Attribution is built into the Nohmo SDK — the SDK reads the Play Store referrer (Android) or system pasteboard (iOS) automatically on first open and sends it to the backend for matching. **Zero code needed in your app.**

4. **Results appear** in **App Analytics → Install Attribution** with a breakdown by source, campaign, and match type.

**Attribution priority:**

| Priority | Method | Accuracy |
|----------|--------|----------|
| 1 (Android) | `nohmo_click` UUID in Play Store referrer | 100% deterministic |
| 1 (iOS) | `nohmo_click` UUID in system pasteboard | 100% deterministic |
| 2 | GAID / IDFA match | Deterministic |
| 3 | UTMs in referrer (no click ID) | High |
| 4 | IP + platform within 24h | Probabilistic |
| 5 | No match | Organic |

> **iOS note:** The App Store has no referrer param, so iOS uses the system pasteboard — deterministic when the user taps through the click interstitial — with GAID/IDFA and probabilistic IP matching as fallbacks.

### Attribution via deep links

Pass UTM params in your deep link URL and the SDK captures them automatically:

```
yourapp://open?utm_source=meta&utm_medium=cpc&utm_campaign=summer
```

Attribution appears in **Traffic → Conversions** and is linked to every event in that session.

### Smart Links — deep linking & deferred deep linking (OneLink-style)

A Nohmo **Smart Link** (`https://www.nohmo.in/s/<projectId>?dlv=<destination>&utm_source=…`)
routes every user to the right place from one URL:

- **Installed app** → opens the app directly to `<destination>` (a *Universal Link* on iOS,
  *App Link* on Android).
- **New user** → routes to the correct App Store, then — after install — the SDK restores
  `<destination>` so they land on the same screen (**deferred deep linking**).

Read the destination in your app with **`onDeepLink`** — it fires for both cases:

```tsx
import { useNohmo } from 'nohmo/react-native'

function useSmartLinkRouting(navigation) {
  const { onDeepLink } = useNohmo()
  useEffect(() => onDeepLink((dest) => {
    // dest is whatever you put in the link's "Destination" field, e.g. "product/123"
    const [screen, id] = dest.split('/')
    navigation.navigate(screen, { id })
  }), [])
}
```

`getDeepLink()` returns the current destination synchronously if you'd rather poll.

Create Smart Links (and set the **Destination**) in the dashboard under
**Settings → Mobile → Smart Links**. Deferred deep linking works out of the box.
To make an **installed** app open directly, do the one-time setup below.

#### One-time setup for direct open (Universal / App Links)

**1. Dashboard** — fill in your app identity under **Settings → Mobile → Deep linking**:
your iOS App ID (`TEAMID.bundle.id`), Android package, and SHA-256 signing fingerprint(s).
Nohmo then publishes the association files automatically:

- `https://www.nohmo.in/.well-known/apple-app-site-association`
- `https://www.nohmo.in/.well-known/assetlinks.json`

**2. iOS** — add the Associated Domain in Xcode (Signing & Capabilities → Associated Domains):

```
applinks:www.nohmo.in
```

**3. Android** — add an App Links intent filter to your launch activity in `AndroidManifest.xml`:

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="www.nohmo.in"
        android:pathPrefix="/s/YOUR_PROJECT_ID" />
</intent-filter>
```

**4.** Wire `onDeepLink` (above) to your navigation. That's it — the same steps AppsFlyer
OneLink requires. Until this setup is done, Smart Links still work as tracking links with
deferred deep linking; they just open the store instead of the installed app.

### Invite a friend (referral attribution)

Want installs from in-app sharing — "invite a friend" — attributed back to the user who shared? Share a Nohmo link instead of the raw store URL. `buildInviteLink()` returns a **short** link that carries the current user's id, so you can see exactly who referred whom.

```tsx
import { Share } from 'react-native'
import { useNohmo } from 'nohmo/react-native'

function InviteButton() {
  const { buildInviteLink } = useNohmo()

  const invite = async () => {
    const link = await buildInviteLink({ channel: 'whatsapp' })
    // → https://www.nohmo.in/api/l/aB3xK9q
    await Share.share({ message: `Join me on the app! ${link}` })
  }

  return <Button title="Invite a friend" onPress={invite} />
}
```

- **Call `linkUser()` first** — the sharer's id is captured as `utm_content`. Without it the link is a generic referral link with no referrer.
- **Returns a short URL** (`/api/l/<code>`). The same user + options always resolves to the same code, and it's cached, so repeated shares never create duplicate links. Offline, it falls back to the full click URL.
- **Options:** `channel` → `utm_medium` (e.g. `'whatsapp'`), `campaign` → `utm_campaign`, `source` → `utm_source` (defaults to `'referral'`).

When the invitee installs through the link, their device's attribution shows the sharer's id — **deterministic on Android** (Play Install Referrer), **best-effort on iOS** (pasteboard when they tap through the click interstitial, probabilistic otherwise). Requires your **iOS App Store URL** to be set in **Settings → App**. Results appear in **App Analytics → Install Attribution** and on each device's **Came from** card.

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
| `FORM_SUBMIT` | Submission of any `<form>` | `tag`, `text` |
| `INPUT_CHANGE` | Change on any `<input>`, `<select>`, or `<textarea>` | `tag`, `text` |
| `JS_ERROR` | Uncaught exception or unhandled promise rejection | `message`, `stack`, `filename`, `lineno` |
| `HTTP_ERROR` | A `fetch`/`XHR` request returning 4xx/5xx, or a resource (img/script/css) that fails to load | `status`, `method`, `url`, `kind` |
| `USER_LINKED` | When `linkUser()` is called | `email` |

Disable any category via the `options` prop.

**Privacy:** `FORM_SUBMIT` and `INPUT_CHANGE` never capture field *values* — only that the interaction happened. Inputs marked `data-sensitive`, password fields, and credit-card fields (`autocomplete="cc-*"`) are skipped entirely, as is any element carrying the `data-nohmo-ignore` attribute.

## Error & crash tracking

Error tracking is **on by default**. The SDK captures:

- **Web** — uncaught JS exceptions and unhandled promise rejections (`JS_ERROR`), plus failed `fetch`/`XHR` requests (4xx/5xx) and resource 404s (`HTTP_ERROR`).
- **React Native** — non-fatal JS errors (`JS_ERROR`) and fatal crashes (`APP_CRASH`), including **native crashes**: Android Java/Kotlin uncaught exceptions, and iOS Objective-C exceptions **and Swift/signal crashes** (force-unwraps, `fatalError`, segfaults). Crashes are persisted natively and reported on the next app launch, attributed back to the session — and journey — they happened in.

Every error is just an event, so it carries the same session and device context as everything else — meaning the dashboard's **Errors** page can show you not just *what* broke but the **journey leading up to the crash**: the exact sequence of pages/screens, clicks, and taps right before it. Group errors are deduplicated by signature, with affected users, devices, and a sample stack trace.

**Real-time alerts:** add an *Event Match* webhook (Settings → Webhooks) on `JS_ERROR` or `APP_CRASH` to get notified the moment errors happen.

**Scope:** native capture covers uncaught JVM exceptions (Android) and Obj-C exceptions + signal crashes (iOS) — not Android NDK/C++ crashes or ANRs. Stack traces are **raw / unsymbolicated** for now (dSYM & ProGuard symbolication are planned).

**Turn it off:**
```tsx
// React / Next.js / React Native
<NohmoProvider options={{ autoErrors: false }} … />
```
```html
<!-- Script tag -->
<script src="…/n.min.js" data-project="…" data-api-key="…" data-errors="false" defer></script>
```

**Privacy:** error messages are truncated, query strings are stripped from captured URLs, and the SDK never reports failures of its own tracking endpoint.

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
| `autoCapture` | `boolean` | `true` | Capture clicks, rage-clicks, form submits, and input changes automatically (field values are never captured) |
| `autoErrors` | `boolean` | `true` | Capture uncaught JS errors, unhandled rejections, failed network requests, and resource 404s as `JS_ERROR` / `HTTP_ERROR` |

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
| **Events** | GA4-style top actions ranked by count / users / per-user, an activity breakdown by event type, and a live recent-activity feed |
| **Journeys** | Page flows (which path users take from page to page) plus entry & exit pages with bounce and exit rates |
| **Traffic → Attribution** | Session breakdown by UTM source, medium, campaign, and custom attribution params |
| **Traffic → Conversions** | Conversion counts by goal, source, medium, campaign — shows which ads drove results |
| **App analytics** | Installs, DAU/MAU, D1/D7/D30 retention, uninstalls & uninstall rate, reinstalls, crashes, platform split, app versions, top screens, and install attribution |
| **Settings → Webhooks** | Friction triggers — fire an HMAC-signed HTTP webhook in real time on rage clicks, a friction-score threshold, or a matched event |

## How it works

1. On first load, a 128-bit random device ID is generated via the Web Crypto API and stored in `localStorage`. Subsequent visits on the same browser reuse it.
2. The SDK registers the device with the Nohmo backend, recording browser, OS, screen resolution, timezone, and language. The backend resolves GeoIP location from the request IP.
3. UTM parameters are read from the URL and stored in `sessionStorage` for the duration of the session.
4. Events are queued locally and flushed in batches via `navigator.sendBeacon`. Each event carries the device ID, session ID, page, timestamp, and any UTM context.
5. When `linkUser()` is called, the device is associated with a real user identity server-side. All prior anonymous events are attributed to that user retroactively.

## Pricing

One plan: **$49/month per project** — unlimited events, no per-event overages. Every project starts with a free **4-day trial** (no card required).

> **🎉 Free during early access.** While Nohmo is in early access, the full platform is free. Email **webesttechnologies@gmail.com** and we'll unlock your project at no cost.

[See full pricing →](https://www.nohmo.in/pricing)

## License

MIT
