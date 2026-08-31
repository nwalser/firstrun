# CLAUDE.md

## What this is

**One structured log for everything you ship, self-hosted, with a query layer on top.**

A customer runs one firstrun and points every surface at it: the marketing site, the desktop
app, the mobile app, the backend. Every surface writes into one table, under one project, on the
customer's own Postgres. An error is a log entry. A page view is a log entry. A latency sample is
a log entry. They differ in what they carry, never in where they go.

The data model is **OpenTelemetry's log data model**, used as the reference so the conventions
have a spec to point at instead of us inventing one: a timestamp, a severity on the 1..24 ladder,
a name, and an attribute map. The backend stays small. The indexing and the query layer do the
heavy lifting.

There used to be a visit-to-install identity join here, and it was the stated product. It is
gone: deleted, not deprecated, no compatibility shim. If you find `person_id`, `identity_edges`,
`person_overrides`, `download_tokens`, `download_hints`, `/v1/download`, `/dl/<token>`,
`packages/identity`, or a number labelled "estimated" anywhere, it is rot from before the pivot.
Delete it. Do not restore it, and do not reintroduce it in another shape.

There used to be a rule here that a generic explore view was the failure mode for this project,
and a fixed catalogue of eight widgets built on top of it. That rule is dead. The query layer is
the product now, and it was chosen deliberately: see the dashboard section below. Do not
reinstate the rule, and do not close the catalogue back up.

First real subject: Themia, a Tauri Windows desktop app with a marketing site, roughly 1,000
monthly users and 40 paying customers. Design for that shape: one small team, one product, a few
surfaces, tens of millions of entries at the very outside.

There is no closed list of surfaces. `packages/schema/src/surface.ts` was deleted, a source has no
`surface` column, and nothing in the schema, the edge or the query layer knows what kind of thing
is writing. A source is one destination, and what sends to it is the customer's business. Where
this file says "surface" it means the ordinary word (a site, an app, a backend), not a value we
store or hold anybody to.

---

## The nine rules a future session will otherwise get wrong

### 1. One structured log for all telemetry. Nothing is special-cased.

- An error, an event and a metric are **the same row shape**. There is no error table, no error
  pipeline, no metrics table, and no separate ingest path for any of them.
- `name` is any string matching the name regex, up to 128 characters. There is no allowlist,
  anywhere, at any layer. A crash is `name = "exception"` at severity 17; an export is
  `name = "exported_csv"` at severity 9; a queue depth is `name = "measurement"` carrying a
  number. All three are one INSERT into one table.
- **Nothing in the backend branches on a name or a severity.** No name triggers different server
  behaviour, no severity routes a row somewhere else, and no entry is derived from another entry.
  Ingest validates shape and writes. That is the whole job.
- `:` and `>` stay out of the name regex and out of `ATTR_SEGMENT_RE`, because derived query keys
  are delimited strings. A name allowed to contain a delimiter could forge a key of a different
  shape. Do not relax either regex without rewriting every key function.

### 2. Meaning comes from convention at write time and from query at read time.

- `packages/schema/src/conventions.ts` is **suggestions, not law**. `ATTR` and `NAME` are the
  keys and names our own clients emit and the ones the pickers offer. `ConventionalName` is not
  the type of a legal name; the type of a legal name is `string`.
- **An entry is never rejected for not following a convention.** A customer who writes `err.msg`
  instead of `exception.message` gets the same storage, the same indexing and the same query
  surface. What they lose is the suggestions and a starting-point board, nothing else.
- Where OpenTelemetry has already named a thing, its name is used verbatim, including the ones
  whose shape we would have chosen differently. Where it has not, the key is namespaced
  `firstrun.*` so it is obvious which half of the vocabulary is ours to change.
- The SDK helpers are **example formats**. `error()` shapes a conventional exception entry,
  `event()` shapes a conventional event, and `log()` takes anything at all. A customer who only
  ever calls `log()` loses nothing.

### 3. Five columns are promoted. Everything else lives in `attributes`.

- The promoted columns are `project_id`, `time`, `distinct_id`, `severity`, `name`. That is the
  whole list. `ingested_at` is stamped beside them for debugging and is not a dimension.
- `os`, `app_version`, `url`, `referrer`, the utm fields, `session_id` and `user_id` are
  **attributes**, queried by path, not columns. So are OTel's `body`, `trace_id` and `span_id`:
  the last two are reserved and currently unused.
- A closed set of columns is a closed set of questions, and the one thing we cannot know in
  advance is which question a customer needs answered. That is why the map is open.
- **Promoting a sixth thing later is a generated column, not a schema break.** Adding
  `os text GENERATED ALWAYS AS (attributes ->> 'os.type') STORED` with an index is a migration
  nobody has to rewrite a query for, because the query layer already reaches the same value by
  path. Keep that possible. Do not add a hand-written column that ingest has to fill.
- The attribute map is bounded in count, depth, key length, string length and item count
  (`packages/schema/src/attributes.ts`). Bounds exist because this is written by anyone holding a
  source key. The shape is closed; the vocabulary is not.
- An attribute path is **data and never reaches SQL as text**. It binds as one `text[]` parameter
  and Postgres walks it: `attributes #>> $1::text[]`. There is no place in that expression for a
  segment to become syntax. A compiler that builds the expression by concatenation instead has
  broken the guarantee, and no regex will put it back.

### 4. The table is partitioned by time from the start.

- `PARTITION BY RANGE (time)`. Every query prunes by range, which is why the range picker is not
  a convenience.
- **Retention is dropping a partition, never a bulk DELETE.** A `DELETE` over tens of millions of
  rows takes a lock, writes as much WAL as the rows it removes, leaves the space to autovacuum,
  and does all of it on the same database serving the dashboard. `DROP TABLE` on one partition is
  a catalogue update.
- Partition maintenance is a scheduled job that creates ahead and drops behind. A write that
  arrives for a partition nobody created is the failure this must not have, and late entries make
  that a real case rather than a theoretical one.

### 5. `time` is client-stamped and authoritative. `ingested_at` is for debugging.

- App entries arrive hours or days late: a laptop is offline, the OS kills the process, the queue
  replays on next launch. This is why every client has a durable queue, and it is the single most
  common cause of a "wrong" number.
- **Never sort, bucket, window or retain on `ingested_at`.** Every series, every time bucket and
  every partition boundary uses `time`. `packages/ingest/test/late-event.test.ts` is that promise
  written down.
- **There is exactly one exception, and it is the billing meter.** `usage_daily` files entries
  under the day they ARRIVED, and `db/usage.ts` is the only place in the repo that does. This is
  not a lapse to clean up. `time` is the client's, so a period counted on it never closes (an
  entry uploaded on the 3rd would change an invoice sent on the 1st) and a client stamping last
  year would fall outside every open period and ingest free forever. Arrival is when the row cost
  us the page it is written on. The rule above governs the query layer, where bucketing on arrival
  would put a laptop's offline week on the wrong days; the meter is the other question and is
  counted the other way. The two numbers will not agree to the row, both are shown, and both say
  which they are.
- OTel calls the pair `timestamp` and `observed_timestamp`. Ours are `time` and `ingested_at`,
  and they mean the same two things.

### 6. Identity is per surface, and is never inferred.

- `distinct_id` is **required on every entry** and is generated by the client. It is anonymous
  and scoped to one surface: a browser visitor id, an app install id, a server process id.
- `user.id` is **only ever the string the customer passed to `identify()`**. We never invent one,
  never derive one, never look one up, never fill it in from anything else.
- A unique has exactly one definition: `count(distinct coalesce(attributes ->> 'user.id',
  distinct_id))`, scoped within one surface.
- **`distinct_id` identifies an INSTALLATION, not a person, so every client persists it to
  machine-local storage.** On Windows that is `%LOCALAPPDATA%`, never `%APPDATA%`: a roaming
  profile syncs the roaming folder between machines, so one person on three of them would share
  one id and report as one install instead of three. `.NET` and `python` originally shipped
  roaming with a reasonable-sounding argument (the id follows the person). It was still wrong: it
  duplicates what `identify()` is for, silently and anonymously, and it made two clients disagree
  about what `distinct_id` means. Every client stores it the same way. Do not "fix" this back.
- **Never sum uniques across surfaces.** The same human on the site and in the app is two
  uniques, and that is the correct answer, not a bug to fix.
- **Two sources in one project are not linked to each other.** No inference, no probabilistic
  matching, no IP or fingerprint heuristics, no merging, ever. If a customer wants a person joined
  across surfaces they call `identify()` with the same id on both. That is their data and their
  decision, not something we reconstruct from behaviour.
- There is no server-side identity computation left. The edge resolves a source key to a
  `project_id` and a source id, stamps `ingested_at`, and writes the row.

### 7. firstrun is never in the customer's critical path.

We do not proxy, redirect, intercept, or sit in front of anything: not a download, not an update
feed, not a login, not a page load. The download endpoint is gone and is not coming back in
another shape.

Every client is **fire-and-forget, non-blocking and bounded**:

- Bounded queue, bounded retries, bounded memory and disk. Full queue drops the oldest entries.
- No exception ever escapes into the host program. A client that cannot send, drops. Losing
  telemetry is always the right trade against affecting the customer's software.
- Nothing blocks a path a human is waiting on. The browser tag uses `sendBeacon` or a `keepalive`
  fetch and never delays a navigation.
- Misconfiguration is silent to the end user: a wrong host, a wrong key, or a 500 from us
  produces no dialog, no console spew in production, and no retry storm.
- Severity does not buy an exemption. A FATAL entry may flush immediately (see
  `docs/delivery-policy.md`), and it still may not block, throw or retry unboundedly.

**If firstrun is completely down, every feature of the customer's app and website still works and
nobody notices.** Any proposal that breaks this is wrong regardless of what it enables. Better
attribution was exactly the thing we traded this away for once, and reversed.

### 8. Permission checks live on the server, in `api.server.ts`.

- Two roles: `admin` changes things, `read` looks. Membership is per workspace and covers every
  project in it.
- `requireAccess` and `requireAdmin` are separate calls. Reading and changing are different
  questions, and answering both with one call is how a reader ends up able to POST.
- The UI hides what a reader cannot do. That is a courtesy, not a permission check. Every
  mutation re-checks server-side.
- The last admin cannot be demoted or removed. A workspace nobody can administer is the one
  unrecoverable state this model allows.

### 9. There are two editions, and the difference is one function.

- **Self-hosted is free, complete and unlicensed.** Every feature is on, there are no ceilings,
  there is no licence key, no phone-home and nothing to unlock. That is not a trial: it is the
  product, and the hosted service is the thing being sold.
- `apps/web/src/lib/billing.server.ts` reads `FIRSTRUN_CLOUD` and **nothing else in the repo may**.
  Everything downstream asks `entitlementsFor()` for a shape it can render, and self-hosted answers
  `UNLIMITED`. There is no second build, no feature flag and no gate to remove.
- **A limit of `null` is NO LIMIT, never zero.** Same idiom as an empty board filter. Every meter,
  banner and upsell in the UI is conditioned on a ceiling existing, so a self-hoster sees none of
  them without a single `if (selfHosted)` anywhere.
- **Nothing on the ingest path consults a plan, in either edition.** Rule 7 is not negotiable for
  commercial reasons: an entry is never refused because somebody is over a limit or behind on a
  payment. Ingest meters and writes. Limits are read on the dashboard and warned about there.
- **Going over the ENTRY limit warns. It does not block, drop, or close a board.** Reading their
  own data is what makes somebody come back and pay, and a customer who loses telemetry over a
  late invoice is a customer who has lost the month, not a customer who upgrades.
- **The project limit IS enforced**, in `addProject` and nowhere else. That is not an
  inconsistency: nothing is lost by not creating a project, the person asking is an admin who is
  present and can act on the message, and it costs them a click. Refusing an entry costs data that
  cannot be resent. Enforce what can be retried; warn about what cannot.
- **`FIRSTRUN_ADMINS` operates the DEPLOYMENT and is a different question from `requireAdmin`.**
  A comma-separated list of GitHub logins, read in `apps/web/src/lib/admin.server.ts`. It is an env
  var rather than a column because the first one has no honest bootstrap inside the app, and
  because "can see every workspace on the box" should be changeable only by whoever can deploy.
  Empty by default, so a self-hosted install has no instance admin at all. It grants counts, plans
  and dates on `/admin`. It does NOT widen `requireAccess`, and it must never be made to: reading
  inside a customer's entries is a support conversation, not a button.
- Pricing is entries per month, measured by `usage_daily`. **Retention is NOT a plan lever**:
  `log_entries` is partitioned by `time` across every workspace, so per-workspace retention would
  need per-workspace DELETEs, which rule 4 exists to prevent.
- The tiers are constants in `packages/schema/src/plan.ts` and are meant to be edited.
  `workspaces.plan_limits` overrides them for one workspace, because the first customers get
  hand-tuned and none of that belongs in the numbers everybody else is measured against.
- Money is Stripe's, and card details never reach this codebase: Checkout and the Billing Portal
  are hosted on Stripe's origin. The price tiers live in Stripe. `PLANS` here is the entitlement
  the meter is drawn against, not the price.

---

## workspace > project > source

| | |
|---|---|
| **workspace** | who can see things, and who can change them. Holds people and projects. |
| **project** | one product. Owns entries, sources and dashboards. |
| **source** | one thing that writes entries. A name and a key, nothing else. Owns nothing. |

- A project is **not** an identity namespace. Two sources in a project are two separate anonymous
  id spaces reported next to each other. This is the largest single change from the old model,
  and old comments that say otherwise are wrong.
- One project per **product** is still the advice, because that is what makes a board readable.
  Getting it wrong is now cosmetic (numbers on the wrong board) rather than structural.
- Clients send a public **source key**: `fr_` and sixteen hex characters, `fr_9f3a2b1c4d5e6f70`.
  See `SOURCE_KEY_RE` in `packages/schema/src/log.ts`. It is public by necessity and authorises
  nothing; it names a destination. There is no segment in it naming a kind of source, because
  there are no kinds.
- **The source a row belongs to is the one whose key it arrived under**, never the body. The edge
  resolves the key and stamps `firstrun.source.id` last in `normalizeEntry`, so a client that puts
  that attribute in its own map cannot claim to have come through a different source.
- The log table is keyed by `project_id`, and partitioned by `time`.

---

## Decisions already made: do not relitigate

| Decision | Choice |
|---|---|
| Everything | **TanStack Start on Solid**, one service, server routes for ingest |
| UI | **shadcn on Tailwind v4**, primitives from **Kobalte**, `cva` + `clsx` + `tailwind-merge` |
| Store | **Postgres only.** Log entries, auth and configuration in one database |
| Data model | **OpenTelemetry's log data model.** One row shape for every kind of telemetry |
| Schema | **Drizzle** owns the DDL and the migrations |
| Partitioning | **`PARTITION BY RANGE (time)`** from the start. Retention drops partitions |
| Queries | **Compiled from a saved query definition**, parameter-bound, never concatenated |
| Driver | **`pg`**, not `postgres.js`. See the gotchas below |
| Ingest | **One endpoint, `POST /v1/e`**, two body shapes: a compact one and an SDK one |
| Deployment | **Railway**, one Dockerfile, one service |
| Auth | **GitHub OAuth**, session token hashed at rest |
| Editions | **Hosted is paid, self-hosted is free and uncapped.** No licence key, ever |
| Billing | **Stripe**, metered subscription. Checkout and Portal, no card fields here |

ClickHouse and SQLite were both removed. At this scale one partitioned Postgres does all of it,
and dedup is the primary key rather than a side table. The crossover is somewhere in the tens of
millions of entries per workspace.

One ingest endpoint rather than two, because the tag's URL is what customers put behind a CNAME,
and a second path is a second thing to get wrong in their proxy config.

---

## The dashboard: a saved query plus a visualisation

A widget is **a saved query and a way of drawing its answer**. The query has five parts and
nothing else:

| part | what it is |
|---|---|
| **filter** | conditions on the promoted columns and on attribute paths. Empty means no constraint, never "nothing" |
| **group by** | zero or more attribute paths or promoted columns |
| **aggregate** | count of entries, count of distinct unique keys, or a numeric aggregate over an attribute |
| **time bucket** | none, or a bucket width the series is drawn at. Always on `time` |
| **limit** | how many groups come back, so a group by on a high-cardinality path is bounded |

Anything expressible in those five parts must be expressible in the UI. A question the product
can answer but the customer cannot ask is the failure mode now.

**Attributes are discovered, not declared.** The pickers list the keys that have actually been
written in the visible range, with the conventional ones offered before a project has sent
anything. There is no registration step, no schema to declare, and a key nobody has sent yet is
not an error: it is a filter that matches nothing.

The old widget catalogue survives as **starting points**: a named query plus a chart type, which
the customer then edits. It is a set of presets, not the set of possible questions. Adding one is
adding a good default. It is not adding a capability, and no card may reach a query the customer
could not have built themselves.

### Query keys are derived, never passed

A card's result is filed under a key derived from **the query, not the card**. The planner builds
the plan by deriving keys; the component that draws the answer looks it up by deriving the same
key from the same query. That is what stops fetch and render disagreeing, and it is why two cards
asking the same question share one query and one result for free. Never hand-write a key string
and never store one.

One `measureBoard()` call serves every card on a board: the layout is known before any SQL runs,
so the queries are deduplicated up front rather than one per widget, twice over. `boardRequests`
dedups on the derived key, and `runQueries` dedups again on the COMPILED statement and its
parameters, which also catches two ASTs that differ only in a default somebody wrote out longhand.
`BoardSnapshot.previous` has the *same shape* as the current window, so computing a delta is one
lookup run twice, and only the cards that ask to be compared are measured in it.

### Cards are placed, not flowed

Layout is **v4**: every widget carries `x, y, w, h` in pixels on a canvas of fixed logical width
(`CANVAS_WIDTH = 1620`), snapped to a **20px grid**. Not a 12-column grid: the point of placing a
card yourself is that you can leave a gap, and a column system is a flow with extra steps that
will reflow a careful arrangement the moment something above it changes height. The canvas keeps
its logical width on every screen and scrolls when the viewport is narrower, because a board
arranged at 1440px that rearranges itself at 1280px is a board somebody has to arrange twice.

FIXED is the rule and the number is free to change. It was 1280 and is now `--page-width-standard`,
the shell's own content column, so the board ends where the toolbar above it ends rather than three
hundred pixels short of the control that switches its mode. A board arranged before the change keeps
every coordinate it had and gains room on the right; nothing moves on its own, which is the property
the rule protects. Changing it again is the same trade, and the templates have to be re-tiled to fill
whatever it becomes.

Width **and** height are both draggable. Overlap is allowed while a human is dragging: they can
see what they are doing. `findFreeSlot` is only for placing a new card.

`parseBoard` (`packages/schema/src/board.ts`) never throws and never loses a mappable card.
Unmappable cards are dropped individually, and a corrupt `range`, `comparison` or `filter` falls
back on its own without taking the widgets with it. There is exactly one board shape and one
reader for it: a board that does not carry the current `BOARD_VERSION` is not read, it is
replaced by an empty one. The version stamp is checked FIRST, because every geometry field has a
default and a widget of some other shape would otherwise validate as a placed widget at 0,0 and
collapse the board into the top-left corner. Do not add a reader for an older shape; bumping
`BOARD_VERSION` is how a board that can no longer be read is retired.

### One project, many boards

A project has an ordered list of dashboards, each with its own layout, its own range and
comparison, and its own **permanent filters**. A filter belongs to the board, not to the viewer:
it survives a reload, a shared link, and the next person to open it. That is the difference
between a board called *Marketing site* and a board you have to re-filter every visit. An empty
filter array means **no constraint**, never "nothing".

### The window and the baseline are separate

`range` is what the numbers are; `comparison` is what "up 12%" means. Both live on the layout,
both are fully customisable (rolling or pinned dates), and the resolved dates of both windows
must be stated on screen. A delta whose baseline is unstated is a number nobody can check.

### Editing is in place

Cards keep rendering live data while being dragged, and per-widget settings open in a drawer,
never inline. A card that grows a form is no longer showing you what it will look like. Placement
is `components/canvas.tsx`, pointer events rather than a library: the obvious Solid choice has not
been published since 2023, and sensors and collision strategies are not what this needs.

Every edit saves as it is made. With drag-to-place there is no natural moment to press Save.

---

## The clients

One backend is only useful if every surface can reach it, so the client family is the product
surface a customer actually touches. They all speak the same wire format, except the browser tag,
which speaks a byte-budgeted compact one.

Six core calls are the contract every client keeps:

```
init(sourceKey, host)     configure, start the queue
event(name, attributes?)  a conventional event entry at INFO
error(err, attributes?)   a conventional exception entry at ERROR
log(entry)                anything at all: name, severity, attributes, your own time
identify(userId)          sets user.id from here on. Never inferred, never guessed
flush()                   best effort, still bounded, still never throws
```

That is the contract, not the whole surface. Every SDK (`clients/node`, `clients/python`,
`clients/go`, `clients/dotnet`) carries the same two groups beside those six, and only the
spelling changes with the language:

- **the level helpers**: `trace`, `debug`, `info`, `warn`, `errorLog`, `fatal`. Each one is
  `log()` with a severity filled in and a body as its first argument, so each is a few lines
  long. `errorLog` is named around `error()`, which takes a thrown thing rather than a string.
- **the lifecycle calls**: `page()` for a conventional page view, `stats()` for what the queue is
  doing (queued, sent, dropped), and `close()` for the one flush a process waits on as it exits,
  which `.NET` spells `Dispose`.

Two go further, and the platform is the reason: `python` and `.NET` persist an identity across
runs, so they also offer `reset()` and a new-session call for a desktop user signing out. A server
process has no such moment, which is why `node` and `go` do not have them. The browser tag differs
the other way. It has `page()`, `navigated()` for a framework router that knows the route before
`history` does, and `consent()`, and it has no level helpers at all, because 4KB is the budget and
a helper nobody calls still costs every visitor bytes.

`event()` and `error()` are **helpers that fill in a convention**, not a type system. Everything
they produce, `log()` can produce by hand, and an entry that follows no convention is stored and
queried identically. A client that rejects an entry for its shape has broken rule 2.

They differ only where the platform forces it: where the durable queue lives, how a background
thread is spawned, how "the process is exiting" is detected, whether there is an identity to
reset. They do not differ in vocabulary, and where one has a call another lacks, the name is still
the name the others would have used. A customer who has read one has read all of them.

Rule 7 is the client contract. A client is allowed to lose entries. A client is not allowed to
throw, block, retry unboundedly, or grow without limit. When and how a client sends is
`docs/delivery-policy.md`, and it never overrides rule 7.

The browser tag is the one client that is **consent-gated**: before consent, nothing is stored and
nothing is sent. `packages/web-tag/test/consent.test.ts` is that promise written down. Do not
weaken it. Desktop and server clients are covered by the customer's own privacy policy for their
own software, which a website in the EU does not get.

The tag measures ordinary site analytics automatically (page views including SPA navigations,
sessions, time on page, outbound and file clicks, form submits, Core Web Vitals) so nobody has to
run a second analytics tag alongside this one. It has a hard 4KB gzipped budget enforced by
`packages/web-tag/test/size.test.ts`, because it loads on someone else's marketing site.

`@firstrun/analytics` ships one npm package with subpath exports (`/react`, `/next`, `/svelte`,
`/vue`, `/astro`), the Vercel Analytics model, rather than five packages: a customer on Next.js
should not have to work out which of five is current. Every wrapper mounts the same `web-tag`
code and does nothing else except tell it about routes when the router knows better than
`history` does.

---

## Design references

`docs/geist-reference.md` holds measured Geist token values and `apps/web/src/styles.css`
implements them. `docs/vercel-structure.md` holds the measured layout and density of the
dashboard shell. Both are measurement rather than recollection: when the port and those files
disagree, those files are right. Use the existing tokens. Do not change token values or names.

---

## Gotchas that cost real time

- **Solid needs `<HydrationScript />` from `solid-js/web` in the document head.** Without it
  nothing hydrates, in dev or production, and the failure surfaces as
  `Cannot read properties of undefined (reading 'done')` inside TanStack's client entry: a seroval
  stream error that names nothing Solid-related. It is in `apps/web/src/routes/__root.tsx`. Do
  not remove it.
- **`postgres.js` cannot serialize a `Date` parameter under Bun.** It throws on every timestamp
  and returns timestamps as strings. The driver is `pg` for that reason, verified rather than
  assumed.
- **The production bundle inlines `db/`**, so `import.meta.url` points into `dist/server/`.
  Migrations, views and query files are located through `db/paths.ts`, with `FIRSTRUN_DB_DIR` as
  the override.
- **Vite plugin order is enforced**: `tanstackStart()` before `viteSolid()`. The reverse fails the
  build with an explicit message.
- **TanStack Start's build does not serve static assets.** `apps/web/server.ts` tries
  `dist/client` first, then falls through to SSR. Without it every `/assets/*` 404s in production
  while pages still render, which looks like a CSS bug and is not.
- `@tanstack/solid-start` is published as a **beta** on the Solid path, and pins its siblings to
  exact versions. Do not float them independently. Its RC line needs Solid 2.0, which
  `vite-plugin-solid` does not support yet (`solid-js/web` moved to `@solidjs/web`), so it will
  not even boot.
- **A widget of some other shape parses cleanly as a current one, and that is a trap.** Every
  geometry field has a default, so a stored `{id, type, width}` validates as a placed widget at
  0,0 with the default size and the whole board silently collapses into the top-left corner
  instead of being rejected. `parseBoard` checks the `version` stamp FIRST for that reason. Do
  not reorder it.
- **A value import from `@firstrun/db` in a component puts Postgres in the browser.** A widget
  that imported a helper from the db package pulled `pg`, `drizzle-orm`, `node:fs` and
  `node:crypto` into the client graph, Vite served them as `__vite-browser-external` stubs, and
  **nothing hydrated**: the page still rendered from SSR and simply ignored every click, which
  reads as a CSS bug and is not. The query AST, the board contract and every result shape live in
  `packages/schema/src/{query,board}.ts`, which is why `db/query.ts` can own the compiler without
  the browser ever seeing it. Client code may import types from `@firstrun/db` and nothing else.
  Check with
  `grep -rn '@firstrun/db' apps/web/src/components apps/web/src/routes`: it should be empty.
- **The sidebar's two widths are real CSS in `styles.css`, not utility classes.** Expressed as a
  named-group arbitrary variant the collapse did not work, while `data-state` flipped correctly on
  every toggle. Two attribute selectors setting `flex-basis` have no variant to compile and no
  group to resolve. The sidebar is a flex item, so its main size is stated as `flex: 0 0 <size>`
  rather than a width.
- **Arbitrary Tailwind variants have silently emitted no CSS here before.** Confirm anything
  non-standard actually reaches the built stylesheet rather than assuming the class name works.
- **Tailwind scans comments.** A class name written in prose inside a `.tsx` comment is generated
  as a real rule. A comment here quoting an arbitrary utility built on a since-deleted custom
  property emitted a live declaration referencing a token that does not exist. Describe such
  classes; do not spell them.
- **The Geist grey scale is not monotonic.** Steps 700 and 800 are identical across themes, and
  dark 800 is darker than dark 700. That is measured, not a typo in the reference. Reproduce it.
  Do not "fix" it into a smooth ramp.
- **`setPointerCapture` throws** on a pointer id that is not active. The canvas guards it, which
  is also what makes it testable with synthetic events.

---

## Layout

```
apps/web/           TanStack Start (Solid): UI, auth, and the ingest routes
  components/ui/    shadcn components, owned here, built on Kobalte
  components/docs/  the customer-facing documentation, as Solid pages
packages/schema/    the contract: log entry, severity, attributes, conventions, query AST, board
packages/ingest/    ingest handlers as plain Request -> Response
packages/web-tag/   the browser tag, vanilla TS, esbuild, 4KB gzipped budget
packages/analytics/ npm package wrapping the tag, one subpath per framework
clients/node/       server-side JavaScript and TypeScript
clients/python/     server-side Python
clients/go/         server-side Go
clients/dotnet/     .NET, including how a Windows desktop app reports
sdk/tauri/          Rust crate for Tauri desktop apps: disk-backed entry queue
db/                 drizzle schema, migrations, partition maintenance, the query compiler, seed
  usage.ts          the billing meter: the one thing counted on arrival, not on `time`
  billing.ts        the workspace's plan and Stripe ids. Hosted service only
  instance.ts       the operator's view of Postgres itself, out of `pg_catalog`
docs/               measured design references, the delivery policy, and billing
```

`packages/schema` is the contract and has no runtime dependencies beyond zod. Both sides of every
boundary import it: the clients for the wire format, the server for normalisation, the UI for the
conventions and the snapshot accessors. If a definition is needed by more than one of those, it
belongs there and nowhere else.

`packages/ingest` handlers are plain `Request -> Response` with no framework, so running one
service on Railway stays a routing decision rather than something baked into the handlers.

---

## House style

- Solid, **not** React. `class` not `className`, `splitProps`. Props are getters: never
  destructure them.
- Icons: `lucide-solid/icons/<name>` subpath imports only.
- 2-space indent, roughly 100 columns, ESM `.js` specifiers.
- Comments explain **why**. Never add AI attribution to a commit, a PR or a file.
- **No em dashes.** A colon, a full stop, or parentheses.
- `routeTree.gen.ts` is generated. Never hand-edit it.
- `bun` is not on PATH here:
  `C:\Users\Nathaniel Walser\AppData\Roaming\npm\node_modules\bun\bin\bun.exe`. Typecheck with
  `node ./node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` and again with
  `-p apps/web/tsconfig.json`.
- Do not write tests unless asked to.

---

## Explicitly NOT in scope

Session replay · feature flags · experiments · minidumps or symbol upload · alerting and on-call ·
**cross-surface identity resolution of any kind**.

Billing used to be on that list and is not any more. See "The two editions" above: it exists, it
is confined to the hosted service, and self-hosting stays free and uncapped.
