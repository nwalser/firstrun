# web-tag

~4.0KB gzipped. Vanilla TS, no dependencies at runtime.

For a framework install (SvelteKit, Next.js, Astro, Vue) use
[`@firstrun/analytics`](../analytics/README.md), which mounts this same code.
This package is the `<script>` tag.

## Not published, on purpose

`@firstrun/web-tag` is `private` and stays that way. Nobody installs it: a site
loads it as `/t.js`, and a framework app gets it inlined, because
`packages/analytics/build.ts` bundles this source into `dist/` and marks only the
framework peers external. `@firstrun/analytics` is the one published entry point,
which is why this package sits in its `devDependencies` rather than its
`dependencies`. Publishing it would put a second copy of the consent rule on the
registry and give a customer a second version to keep in step with the first.

## Install

```html
<script async
        src="https://t.themia.app/t.js"
        data-key="fr_5eed000000000001"></script>
```

The `data-key` is the source key from the workspace's Sources page. It is public
by necessity and authorises nothing.

`/t.js` is one file and takes no query string: every source is served the same
bytes, so it caches for an hour in anything sitting in front of you.

Serve `/t.js` from a subdomain CNAMEd at the ingest host. The tag defaults its
API host to wherever it was served from, so first-party proxying needs no extra
configuration.

To queue calls before the script has loaded:

```html
<script>window.fr=window.fr||function(){(fr.q=fr.q||[]).push(arguments)}</script>
```

## Everything it sends is a log entry

There is one shape, and it is OpenTelemetry's log record:

```
name         page_view, exception, web_vital, or any name you invent
severity     1..24. 9 is INFO, 17 is ERROR. Absent means unclassified
attributes   an open map. exception.type, url.path, firstrun.value, yours
time         when it happened, stamped on this machine
```

A page view, a Core Web Vital and an uncaught exception differ in what they
carry and in nothing else. There is no event type, no error type and no metric
type, here or on the server.

## Nothing here is in your way

The tag never calls `preventDefault`, never rewrites an `href`, never delays a
navigation, and never waits for a response. Entries go out through `sendBeacon`
(or a `keepalive` fetch where that is missing) and are forgotten; there is no
retry, and the in-memory buffer is capped at 50 entries.

Every listener, observer callback and public method is wrapped so that no
exception from this file can reach your code. If the ingest host is unreachable,
slow, or blocked outright, the page behaves exactly as it would if this script
had never loaded, including every download button on it.

## Consent

Nothing is stored and nothing is sent until you say so, including everything the
tag measures on its own and including entries at ERROR. Anything that happens
while the banner is still up is held in memory, and sent only if the answer is
yes.

```js
fr('consent', true);   // start storing, send what was held
fr('consent', false);  // clear what is stored and drop what was held
```

### Or have nothing to ask about

`data-ephemeral="true"` moves the three keys to `sessionStorage` and opens the
gate. The id is gone when the tab closes, so there is no persistent identifier
on the device and nothing for a banner to be about.

```html
<script async src="…/t.js" data-key="fr_…" data-ephemeral="true"></script>
```

What it costs is the visit that spans a closed tab. The session clock lives in
the tab, so coming back tomorrow is a new session rather than a returning one,
and uniques across days are an overcount. Counts of entries are exactly as
correct as before, which is why this suits a marketing site measuring signups
and downloads and does not suit a product measuring how many people came back.

It does not turn the session rules off. `session.id` still cuts on 30 minutes
idle and on a new referring site, inside the tab's lifetime.

## The calls

```js
fr('event', 'clicked_pricing', { plan: 'pro' });      // a conventional event, at INFO
fr('error', err, { 'firstrun.form.id': 'checkout' }); // a conventional exception, at ERROR
fr('log', { name: 'queue.drained', severity: 5,       // anything at all
            attributes: { 'firstrun.value': 12 } });
fr('user', 'u_42');       // your own user id. Never inferred, never guessed
fr('user', null);         // signed out
fr('device', 'mach-7');   // a machine you actually know. See below
fr('session', 's_new');   // replace the session id. There is no newSession
fr('page');               // an unconditional page view
fr('flush');
```

`event` and `error` are **helpers that fill in a convention**, not a type system.
Everything they produce, `log` can produce by hand, and an entry that follows no
convention is stored, indexed and queried identically. Any name matching
`[A-Za-z0-9][A-Za-z0-9_.-]{0,127}` is a valid name; there is no allowlist at any
layer.

Attribute values keep their type. A number stays a number, so averaging one is
an aggregate rather than a cast over every row. What JSON cannot carry
(functions, BigInt, `NaN`, `Infinity`) is dropped from that one entry rather than
costing the batch around it.

`user` sets `user.id` for the rest of the page and is never written to storage.
Naming a *different* person also replaces the session id, because a sign-in is a
boundary; naming the same one again does nothing, so a router may call it on
every route change.

`session.id` is kept for you: a visit ends after 30 idle minutes or on arrival
from a new referring site, and it survives an ordinary page load. `session` only
exists for an app that would rather decide itself.

`device.id` is **absent by default and that is deliberate**. There is no device
to find out in a browser: everything a page can read describes software, not a
machine. `device` is there for a page inside a Tauri or Electron shell that can
ask the OS. For anything else there is the fingerprint below, and neither is
ever linked to an id from your app or your backend.

## Fingerprinting

Off by default, and gated twice: the attribute **and** consent.

```html
<script async src="…/t.js" data-key="fr_…" data-fingerprint="true"></script>
```

It hashes screen geometry, the device pixel ratio, the timezone, the language
and the two hardware counters into a `device.id`. No canvas and no WebGL: they
cost hundreds of bytes against the size budget, milliseconds on a main thread
that is not ours, and every serious privacy tool randomises them anyway.

**It collides between two identical machines and changes when the OS updates or
the window moves to a second monitor.** It is a trend line, not a headcount. If
you need an exact number of people, call `user` with an id you already have.

Whether it is lawful where you operate is your question, which is why it is off
until you answer it.

## Counting a click

`data-fr-event` on any element fires that event when the element is clicked, and
does nothing else. The element keeps its own behaviour: a link still navigates
to its own `href`, a button still submits.

```html
<a href="/dl/Themia-Setup-1.4.2.exe" data-fr-event="download_clicked">
  Download for Windows
</a>
```

That is all a download button is here. It is an ordinary link, hosted wherever
you host it, that happens to be counted. `download_clicked` is treated exactly
like `exported_csv` or any other name you invent.

The attribute works even with `data-auto-outbound="false"`: it is something you
asked for by writing it, not part of the automatic measurement.

### Saying which one it was

Every other `data-fr-*` attribute on the same element becomes an attribute of
the entry, with the prefix stripped:

```html
<button data-fr-event="checkout_started" data-fr-plan="pro" data-fr-seats="5">
  Upgrade
</button>
```

That writes `checkout_started` with `{ plan: "pro", seats: 5 }`. A value that
reads as a number is sent as a number, so averaging it is an aggregate rather
than a cast when you query it. Everything else travels as the string you wrote,
because HTML has no other types and guessing at booleans would make
`data-fr-plan="false"` a boolean.

HTML lower-cases attribute names, so write them in kebab-case:
`data-fr-plan-name` arrives as `plan-name`, and `data-fr-planName` arrives as
`plan-name` too whether you meant it to or not.

### Counting a submit instead of a click

`data-fr-on="submit"` moves the trigger from the click to the form's own submit
event, which is what you want on a form: a form sent with the Enter key never
produced a click, and a marked submit button inside a form would otherwise be
counted on the click and again on the submit.

```html
<form id="signup" data-fr-event="signed_up" data-fr-on="submit" data-fr-source="hero">
  ...
</form>
```

Like `data-fr-event`, this works with `data-auto-forms="false"`. Turning the
automatic `form_submit` measurement off to avoid counting every search box does
not turn off the one form you asked for by name.

Neither attribute reads a field or a value, and there is no configuration that
would make one be. What is sent is what you wrote in the markup.

## What it measures without being asked

Every one of these is `severity: 9` (INFO).

| Name | When | Attributes |
|---|---|---|
| `session_start` | first entry of a visit: after 30 idle minutes, or a new referring site | - |
| `page_view` | load, and every SPA path change | `url.full`, `url.path`, `firstrun.referrer`, `firstrun.referrer.host`, `firstrun.utm.*` |
| `page_leave` | the page is hidden or left | `firstrun.duration_ms` (visible time only), `firstrun.scroll_pct` |
| `outbound_click` | a link to another origin | `url.full`, `url.domain` |
| `file_download` | a link to a file, wherever it is hosted | `url.full`, `firstrun.file.ext` |
| `web_vital` | once per metric, when the page is hidden | `firstrun.metric`, `firstrun.value`, `firstrun.unit` |
| `form_submit` | a `<form>` submits | `firstrun.form.id`, `firstrun.form.name` |

The session id and your language go on the batch's **resource**, once, rather
than on every entry. The server merges them into each row on the way in, so a
query never has to join to find them.

Sessions are cut on the client because only the client knows the tab is the same
tab. Vitals are observed directly (no `web-vitals` dependency), and a metric the
browser cannot report is simply absent. A vital carries the number, not a
good/needs-improvement/poor rating: the server has Google's thresholds and
classifies at read time, which is the only way a threshold change ever applies
to the samples you already collected.

`form_submit` carries the form's id and name. Never its values.

## Uncaught errors: off unless you ask

`data-auto-errors="true"` reports uncaught errors and unhandled promise
rejections as `exception` entries at ERROR, following the OTel convention:

```html
<script async src="…/t.js" data-key="fr_…" data-auto-errors="true"></script>
```

It is the one automatic measurement that defaults to **off**, for two reasons.
It is a behaviour change for a site already running this tag, and its volume is
not something the page controls: a third-party widget throwing on every load, or
a rejected fetch in a retry loop, produces entries at a rate nobody chose.

We listen rather than assign `window.onerror`, so whatever you or your framework
already installed keeps working, and we never call `preventDefault`: the error
still reaches your console and every other listener. A failed `<img>` or
`<script>` is not an exception and is skipped.

An entry at ERROR or worse is sent **immediately** rather than at the next
flush, because a crash report that waits is a crash report that usually does not
arrive. It still never blocks, never retries and never throws.

## Switching it off

Each attribute defaults to on and is off when set to `false`. Somebody who wants
only their own `fr('event', …)` calls turns all five off.

| Attribute | What stops |
|---|---|
| `data-auto-page="false"` | `page_view` on SPA navigations |
| `data-auto-outbound="false"` | `outbound_click` and `file_download` |
| `data-auto-vitals="false"` | `web_vital` |
| `data-auto-forms="false"` | `form_submit` |
| `data-track-leave="false"` | `page_leave` |
| `data-auto-errors="true"` | starts `exception` (off by default) |
| `data-ephemeral="true"` | id in `sessionStorage`, no consent gate (off by default) |
| `data-global="frx"` | renames the `fr` global |
| `data-host="https://…"` | overrides the API host |
| `data-mode="interval"` | changes the schedule, see below |

## When it sends

The default is `immediate`, because a page does not live long enough for a timer
to be worth waiting for and a visit that ends before the first tick sends
nothing at all. See `docs/delivery-policy.md`.

**`immediate` does not mean one request per entry.** Entries produced together
coalesce: the first one opens a 250ms window, everything raised while it is open
rides along, and one beacon goes out when it closes. A page view followed by
three clicks is one beacon rather than four, and a loop calling `event()` a
thousand times is twenty full batches rather than a thousand requests. Nothing
waits on a send, and no call is ever on your critical path.

Three things send without waiting for the window:

- **an entry at ERROR or worse** (`flushOnSeverity`, default 17). A crash report
  that waits for the next window is a crash report that usually does not arrive,
  because by then the page is gone.
- **a full batch**, at 50 entries. Sending a full batch is better than the only
  other thing that happens at that depth, which is dropping the oldest entry in
  it.
- **`visibilitychange` to hidden and `pagehide`**, the backstop for anything
  produced since the last send. This is the browser's `flushOnExit`, and it is
  always on.

| `data-mode` | what it does |
|---|---|
| `immediate` | the default, above |
| `interval` | one beacon every 30s, or whenever a batch fills |
| `manual` | only `fr('flush')`, plus the two rules above it |

There is no `startup` mode and no durable queue. `startup` means "drain what
survived the last run", and nothing survives a page; it is only coherent with
disk persistence, and a queue in `localStorage` is unsent analytics on the disk
of a visitor who never came back, which is exactly what withdrawing consent is
supposed to prevent. An unrecognised mode falls back to `immediate` rather than
to sending nothing.

The buffer holds 50 entries, well under the server's cap of 500 per request.
Past 50 the oldest is dropped and counted, and the count rides out on the batch
resource as `firstrun.dropped`, so a queue that is dropping says so in your own
data rather than only in a debugger.

`flushOnSeverity` is an option on `start()` for anyone importing the package,
not an attribute: the default is already the right answer, and an attribute
nobody sets still costs every visitor bytes. Same for the coalescing window and
the batch size, which are constants here.

## Layout

- `src/core.ts`: every decision, with the browser behind `Env`. What
  `test/consent.test.ts` points at.
- `src/browser.ts`: the DOM, storage, the beacon, the observers. Exports
  `start()`, so `@firstrun/analytics` can mount the same code.
- `src/tag.ts`: the `<script>` entry. Reads the attributes, calls `start()`.
- `test/delivery.test.ts`: the delivery policy as assertions, with the clock
  injected so "one beacon, not a thousand" is counted rather than waited for.

## Budget

The build fails above 4KB gzipped. `bun run check:size`, and `test/size.test.ts`
enforces the same number in `bun test`.

It currently lands at 4072 B, which is 24 B under. That is not headroom: this
file is full. The next feature has to displace something rather than argue the
budget up.
