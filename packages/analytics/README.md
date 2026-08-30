# @firstrun/analytics

One package, one subpath per framework. Page views, sessions, time on page,
scroll depth, outbound clicks, file downloads, form submits and Core Web Vitals,
plus anything you record yourself.

Nothing is stored and nothing is sent until you call `consent(true)`.

```
@firstrun/analytics          core: init / event / error / log / identify / consent / page / flush / stop
@firstrun/analytics/react    <Analytics /> + useFirstrun()   React, Vite, Remix, Next Pages Router
@firstrun/analytics/next     <Analytics /> wired to next/navigation   Next App Router
@firstrun/analytics/svelte   a Svelte action and an init helper   SvelteKit
@firstrun/analytics/astro    an Astro component wrapping the script tag
@firstrun/analytics/vue      <Analytics /> for Vue 3
```

The measurement itself lives in `@firstrun/web-tag` and every wrapper mounts the
same code. A wrapper's whole job is: mount, tell us about routes if the router
knows better than `history` does, unmount cleanly.

## Everything it sends is a log entry

There is one shape, and it is OpenTelemetry's log record. A page view, a Core
Web Vital and an uncaught exception differ in what they carry, never in what
they are:

```
name         page_view, exception, web_vital, or any name you invent
severity     1..24. 9 is INFO, 17 is ERROR. Absent means unclassified
attributes   an open map. url.path, exception.type, firstrun.value, yours
time         when it happened, stamped in this browser
```

There is no event type, no error type and no metric type, here or anywhere
below this package. `event()` and `error()` are `log()` with a convention
filled in, and an entry that follows no convention at all is stored, indexed
and queried identically.

## Nothing here is in your way

This package never proxies, intercepts, or redirects anything, and it never sits
in front of a link. It does not call `preventDefault`, does not rewrite an
`href`, does not delay a navigation, and does not wait for a response. Entries
go out through `sendBeacon` and are forgotten: no retry, and a buffer capped at
50.

Every export is total. It returns, it does not throw, and it does not block, so
a mount inside `useEffect` cannot take a render down with it. If firstrun is
unreachable, slow, or blocked outright, your site behaves exactly as it would
without this package installed.

## Two settings

| | |
|---|---|
| `sourceKey` | `fr_web_…`, from the workspace's **Sources** page. Public by necessity; it identifies and authorises nothing. |
| `host` | The ingest origin: a subdomain CNAMEd at firstrun, e.g. `https://t.themia.app`. |

It is `sourceKey`, not `key`, because React consumes a prop called `key` before
the component ever sees it.

---

## SvelteKit

`src/routes/+layout.svelte`:

```svelte
<script>
  import { onMount } from 'svelte';
  import { initFirstrun } from '@firstrun/analytics/svelte';

  onMount(() =>
    initFirstrun({
      sourceKey: 'fr_web_5eed000000000001',
      host: 'https://t.themia.app',
    })
  );
</script>

<slot />
```

SvelteKit navigates through `history.pushState`, so client-side route changes
are picked up without anything further.

There is also an action, if you would rather write it in markup:

```svelte
<script>
  import { firstrun } from '@firstrun/analytics/svelte';
  const config = { sourceKey: 'fr_web_5eed000000000001', host: 'https://t.themia.app' };
</script>

<div use:firstrun={config} />
```

## Next.js: App Router

`app/layout.tsx`:

```tsx
import { Analytics } from '@firstrun/analytics/next';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics sourceKey="fr_web_5eed000000000001" host="https://t.themia.app" />
      </body>
    </html>
  );
}
```

The component is already `"use client"`; the layout does not have to be. Route
changes come from `usePathname()`, so no Suspense boundary is needed.

## Next.js: Pages Router

`pages/_app.tsx`:

```tsx
import type { AppProps } from 'next/app';
import { Analytics } from '@firstrun/analytics/react';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Component {...pageProps} />
      <Analytics sourceKey="fr_web_5eed000000000001" host="https://t.themia.app" />
    </>
  );
}
```

`@firstrun/analytics/react`, not `/next`: `next/router` navigates through
`history.pushState`, which is watched already, and `next/navigation` does not
exist in the Pages Router.

## Astro

`src/layouts/Layout.astro`:

```astro
---
import Analytics from '@firstrun/analytics/astro';
---

<html lang="en">
  <head>
    <Analytics sourceKey="fr_web_5eed000000000001" host="https://t.themia.app" />
  </head>
  <body><slot /></body>
</html>
```

This one renders the `<script>` rather than importing a module, so an Astro site
that ships no client JavaScript still ships none of ours beyond the tag itself.

## Vue 3

`src/App.vue`:

```vue
<script setup lang="ts">
import { Analytics } from '@firstrun/analytics/vue';
</script>

<template>
  <RouterView />
  <Analytics source-key="fr_web_5eed000000000001" host="https://t.themia.app" />
</template>
```

## Plain `<script>`: no build step

```html
<script>window.fr=window.fr||function(){(fr.q=fr.q||[]).push(arguments)}</script>
<script async
        src="https://t.themia.app/t.js"
        data-key="fr_web_5eed000000000001"></script>
```

The first line queues calls made before the tag has loaded. The tag defaults its
API host to wherever it was served from, so first-party proxying needs no second
setting; `data-host` overrides it.

Then `fr('consent', true)`, `fr('event', 'name', { … })`, `fr('error', err)`,
`fr('log', { name, severity, attributes })`, `fr('identify', id)`, `fr('page')`,
`fr('flush')`.

---

## Consent

Nothing is stored and nothing is sent until this is called with `true`. Entries
recorded while the banner is still up are held in memory, and sent only if the
answer is yes. Severity buys no exemption: an ERROR raised before the answer is
held like everything else.

```ts
import { consent } from '@firstrun/analytics';

consent(true);   // persist a distinct id, send what was held
consent(false);  // clear the id and drop what was held
```

In the plain-script install: `fr('consent', true)`.

## Recording your own entries

### `event(name, attributes?)`

A conventional entry at INFO, under any name you like.

```ts
import { event, identify } from '@firstrun/analytics';

event('clicked_pricing', { plan: 'pro' });
event('exported_csv', { rows: 4200 });
identify('u_42');   // your own user id, as a string
identify(null);     // signed out
```

Any name up to 128 characters of `[A-Za-z0-9_.-]`, starting with a letter or a
digit. Nothing is special-cased: `page_view` and `invoice.exported` are the same
kind of thing to every layer below this one, and there is no allowlist at any of
them.

Attribute values keep their JSON type. A number stays a number, so averaging one
is an aggregate rather than a cast over every row. What cannot survive the wire
is dropped rather than mangled: functions, symbols, BigInt, `NaN` and
`Infinity`.

### `error(err, attributes?)`

A conventional exception entry at ERROR. It takes anything, because a `catch`
block catches anything: an `Error`, a string, a rejected promise carrying a
number.

```ts
import { error } from '@firstrun/analytics';

try {
  await save(doc);
} catch (err) {
  error(err, { 'firstrun.doc.kind': 'invoice' });
}
```

The name is `exception` for every one of them, and the detail goes in the
`exception.*` attributes, which is OpenTelemetry's shape. That means "all
exceptions" is one name and "this exception" is a filter on an attribute path,
rather than a thousand names nobody can enumerate:

| attribute | |
|---|---|
| `exception.type` | the class of the thrown thing, e.g. `TypeError` |
| `exception.message` | its message, or the thrown value stringified |
| `exception.stacktrace` | the formatted stack, when there is one |

An exception is sent at once rather than at the next flush. The page may not be
there later, which is most of the point of having recorded it.

### `log(entry)`

The escape hatch: an entry exactly as given, with no convention applied and
nothing filled in but an id and a timestamp.

```ts
import { log } from '@firstrun/analytics';

log({
  name: 'measurement',
  severity: 9,
  attributes: { 'firstrun.metric': 'cart_items', 'firstrun.value': 3 },
});

log({ name: 'checkout.stalled', severity: 13 });        // WARN, no attributes
log({ name: 'replayed', time: Date.now() - 60_000 });   // unclassified, backdated
```

`severity` is the OpenTelemetry 1..24 ladder: 1 TRACE, 5 DEBUG, 9 INFO, 13 WARN,
17 ERROR, 21 FATAL, with three further steps inside each band. Omitting it means
unclassified, which is not the same as INFO.

An entry that follows none of the conventions above is stored, indexed and
queried identically to one that follows all of them. A customer who only ever
calls `log` loses the suggestions in the attribute pickers and nothing else.

### `identify(userId)`

Sets the `user.id` attribute and nothing else. firstrun never infers one, never
derives one from behaviour, and never links this browser's anonymous
`distinct_id` to an id from your app or your backend. If you want one person
counted once across surfaces, call `identify` with the same id on each.

The id is held for the life of the page and never written to storage.

### From markup

`data-fr-event` on any element fires that event when it is clicked, and does
nothing else. The element keeps its own behaviour, so the link below still
downloads whether or not this package loaded:

```html
<a href="/dl/Themia-Setup-1.4.2.exe" data-fr-event="download_clicked">
  Download for Windows
</a>
```

### In React

`useFirstrun()` returns the same functions if you prefer a hook. The object it
returns never changes identity, so it is safe in a dependency array:

```tsx
import { useFirstrun } from '@firstrun/analytics/react';

const { event, error, log } = useFirstrun();
```

## The rest of the API

| | |
|---|---|
| `init(config)` | Mount the tag. Idempotent for the same source key, so React's double effect in development costs nothing. The framework wrappers call it for you. |
| `page()` | An unconditional page view. |
| `navigated()` | A route change. Fires a page view only if the path actually moved, so a router that re-renders on every query string change costs nothing. |
| `flush()` | Best effort, bounded, never throws. There is no retry behind it. |
| `stop()` | Remove every listener, restore `history`, send what is buffered. |

## Turning the automatic entries off

Everything below is on by default except the last one. Each is off when set to
`false`.

| Option | Script attribute | What stops |
|---|---|---|
| `autoPage` | `data-auto-page="false"` | `page_view` on SPA navigations |
| `autoOutbound` | `data-auto-outbound="false"` | `outbound_click` and `file_download` |
| `autoVitals` | `data-auto-vitals="false"` | `web_vital` (LCP, INP, CLS, FCP, TTFB) |
| `autoForms` | `data-auto-forms="false"` | `form_submit` |
| `trackLeave` | `data-track-leave="false"` | `page_leave` |
| `autoErrors` | `data-auto-errors="true"` | **off by default.** Set it to switch uncaught errors and unhandled rejections ON |

`autoErrors` is the one that has to be asked for. It is a behaviour change for a
site already running this, and it is the only measurement here whose volume the
page does not control: one third-party widget throwing on every load, or a
rejected fetch in a retry loop, produces entries at a rate nobody chose. When it
is on, the entries are ordinary `exception` entries carrying
`exception.escaped: true`, and a rejection is marked
`firstrun.exception.source: "unhandledrejection"`. Nothing is suppressed: the
error still reaches the console and every other listener exactly as it would
have.

One more setting has no script attribute, because it only makes sense to a
bundled integration:

| | |
|---|---|
| `global` | Also expose the command API under a global name, for markup that has to call it (a cookie banner rendered by a third party, say). Off by default here. |

The first `page_view`, `session_start`, `data-fr-event`, and anything you record
yourself are not affected by any of the switches above: those are the tag, not
the automation.

Somebody who wants only their own entries writes:

```tsx
<Analytics
  sourceKey="fr_web_5eed000000000001"
  host="https://t.themia.app"
  autoPage={false}
  autoOutbound={false}
  autoVitals={false}
  autoForms={false}
  trackLeave={false}
/>
```

or, as a script tag:

```html
<script async
        src="https://t.themia.app/t.js"
        data-key="fr_web_5eed000000000001"
        data-auto-page="false"
        data-auto-outbound="false"
        data-auto-vitals="false"
        data-auto-forms="false"
        data-track-leave="false"></script>
```

## When it sends

The default is `immediate`, because a page does not live long enough for a timer
to be worth waiting for and a visit that ends before the first tick sends
nothing at all. The full rules, and the same two axes every other firstrun
client uses, are in `docs/delivery-policy.md`.

**`immediate` does not mean one request per entry.** Entries produced together
coalesce: the first opens a 250ms window, everything raised while it is open
rides along, and one beacon goes out when it closes. A page view followed by
three clicks is one beacon rather than four, and a loop calling `event()` a
thousand times is twenty full batches rather than a thousand requests. Nothing
waits on a send, so no call here is on a path a human is waiting on.

Three things send without waiting for the window:

- **an entry at ERROR or worse**, which is `flushOnSeverity` and defaults to 17.
  A crash report that waits for the next window is a crash report that usually
  does not arrive, because by then the page is gone. This is the setting that
  makes reporting an exception from a page work at all.
- **a full batch**, at 50 entries. Sending a full batch beats the only other
  thing that happens at that depth, which is dropping the oldest entry in it.
- **`visibilitychange` to hidden and `pagehide`**, the backstop for anything
  produced since the last send. This is the browser's `flushOnExit`, it is
  always on, and it costs nothing: `sendBeacon` hands the body to the browser
  and returns, so it cannot hold a navigation open.

| `mode` | Script attribute | What it does |
|---|---|---|
| `"immediate"` | `data-mode="immediate"` | the default, above |
| `"interval"` | `data-mode="interval"` | one beacon every `flushEvery` (default 30000ms), or whenever a batch fills |
| `"manual"` | `data-mode="manual"` | only `flush()`, plus the two rules above it |

| | |
|---|---|
| `mode` | The schedule. Default `"immediate"`. |
| `flushOnSeverity` | Severity at or above which an entry sends at once. Default 17 (ERROR). Lower it to 9 to send everything as it is made; raise it past 24 to batch exceptions with everything else. |
| `flushEvery` | Upper bound between flushes, in milliseconds, in `interval` mode only. Default 30000; zero disables the timer. Ignored by the other two modes. |

Persistence is **memory**, and there is no option for anything else. A durable
queue in `localStorage` means unsent analytics sitting on the disk of a visitor
who never came back, which is what withdrawing consent is supposed to prevent.
That is also why there is no `startup` mode: it means "drain what survived the
last run", nothing survives a page, and a mode that can only ever send nothing
is worse than one that sends now. An unrecognised mode falls back to
`immediate`.

The buffer holds 50 entries, well under the server's cap of 500 per request.
Past 50 the oldest is dropped and counted, and the count goes out on the batch
resource as `firstrun.dropped`, so a queue that is dropping says so in your own
data.

## What gets sent

Every one of these is a log entry. The automatic ones sit at INFO (9); an
exception sits at ERROR (17).

| Name | When | Attributes |
|---|---|---|
| `session_start` | first entry of a visit: after 30 idle minutes, or arriving from a new site | none |
| `page_view` | load, and every SPA path change | `url.full`, `url.path`, `firstrun.referrer`, `firstrun.referrer.host`, `firstrun.utm.source`, `firstrun.utm.medium`, `firstrun.utm.campaign` |
| `page_leave` | the page is hidden or left | `firstrun.duration_ms` (visible time only), `firstrun.scroll_pct` |
| `outbound_click` | a link to another origin | `url.full`, `url.domain` |
| `file_download` | a link to a file, wherever it is hosted | `url.full`, `firstrun.file.ext` |
| `web_vital` | once per metric per document, when the page is hidden | `firstrun.metric`, `firstrun.value`, `firstrun.unit` |
| `form_submit` | a `<form>` submits | `firstrun.form.id`, `firstrun.form.name` |
| `exception` | only with `autoErrors` on | `exception.type`, `exception.message`, `exception.stacktrace`, `exception.escaped`, `url.full` |

`form_submit` carries the form's id and name. It never carries what was typed
into it.

A Core Web Vital is a measurement and not a kind of its own: `firstrun.metric`
says which one, `firstrun.value` carries the number. It is exactly the shape a
queue depth from a desktop app would use, which is why nothing downstream needs
a special case for it. There is no `rating` on the entry, deliberately: Google's
thresholds live on the server and are applied at read time, which is the only
way a threshold change ever reaches the samples already collected.

Three more attributes ride along on every entry, sent once per batch rather than
copied onto each one on the wire: `session.id`, `browser.language`, and
`user.id` once you have called `identify`. A fourth, `firstrun.dropped`, appears
only once the buffer has had to drop something, and says how much.

Sessions are cut on the client, not the server: only the client knows the tab is
the same tab.
