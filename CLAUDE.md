# CLAUDE.md — firstrun

## What this is

An analytics backend whose one differentiating capability is **joining a website visitor to an app installation as the same person**.

```
visit → download → install → first run → activated → paying
```

Every existing tool owns one segment and breaks at the handoffs. **The handoff is the product.** Everything else is table stakes.

First real subject: Themia — a Tauri Windows desktop app with a marketing site, ~1,000 monthly users, ~40 paying customers. Design for that shape.

---

## The four rules a future session will otherwise get wrong

### 1. Exact joins mutate `person_id`. Estimated joins never do.

- `method='token'` and `method='account'` are **exact**. They write an `identity_edge`, write `person_overrides`, and change which person an event belongs to.
- `method='estimate'` writes an `identity_edge` **and nothing else**. It never writes `person_overrides`, never touches `events.person_id`, and is never followed by `resolve()`.
- Estimated edges are read only by aggregate funnel queries, which return exact and estimated as **two separate numbers**, labelled. Never add them together.
- `packages/identity/test/estimate-never-mutates.test.ts` fails if this is violated. Do not weaken it.

### 2. `event_time` and `ingest_time` are separate and both required.

- `event_time` is client-stamped and **authoritative**. App events arrive hours or days late — a laptop is offline, the OS kills the process, the queue replays on next launch.
- `ingest_time` is server-stamped and exists for debugging only.
- **Never sort, bucket, window, or retain on `ingest_time`.** Every funnel, retention and day-bucket query uses `event_time`.

### 3. `person_id` is derived. A client never sends one.

- Clients send distincts: `web_visitor_id`, `install_id`, `account_id`.
- `person_id` is computed server-side by `packages/identity` and nothing else computes it.
- Seed identity: `person_id = uuidv5(NS, "<workspace_id>:<type>:<id>")`. Deterministic, so a distinct that has never been joined still has a stable person.
- Canonical person for a merged component = **lowest UUID** among the component's seed ids, so replaying edges in any order lands on the same person.

### 4. A workspace is one identity namespace. Sources are not.

- A **workspace** owns people. A **source** (the marketing site, the desktop app) is an ingestion endpoint inside it and nothing more.
- If the site and the app had separate person spaces, the web-to-install join could not exist — which is the entire product.
- One workspace per product, never per platform. The create-workspace screen says so on purpose.
- Clients send a public **source key** (`fr_web_…`, `fr_app_…`), never an internal id. The key identifies and authorises nothing.

---

## Decisions already made — do not relitigate

| Decision | Choice |
|---|---|
| Everything | **TanStack Start on Solid**, one service, server routes for ingest |
| Store | **Postgres only.** Events, identity, auth and configuration in one database |
| Schema | **Drizzle** owns the DDL and the migrations |
| Analytics queries | **Hand-written SQL files** in `db/queries/`. Not an ORM, not Drizzle |
| Driver | **`pg`**, not `postgres.js` — see the gotchas below |
| Deployment | **Railway**, one Dockerfile, one service |
| Auth | **GitHub OAuth**, session token hashed at rest |
| Web identity | Identified, consent-gated. Persistent visitor id, nothing stored before consent |

ClickHouse and SQLite were both removed. At this scale one Postgres does all of it, the squash job becomes an ordinary transactional `UPDATE`, and dedup is the events primary key rather than a side table. The crossover is somewhere in the tens of millions of events per workspace.

---

## The join

1. **Mint on download.** `GET /v1/download?key=<source key>&vid=<visitor>` mints an 8-char Crockford base32 token, 7-day expiry, and `302`s to `/dl/<token>/<Asset>-<version>-<token>.exe`. **The token lives in the filename.**
2. **Claim on first run.** An NSIS hook reads the installer's own `$EXEPATH` and writes the token to `%LOCALAPPDATA%\<App>\install_token`. Fallback: scan Downloads for `*-([0-9A-HJKMNP-TV-Z]{8}).exe`, newest wins. Then `POST /v1/claim` once, then delete the token file.
3. **Confirm on login.** An `account_id` on either surface supersedes. `method='account'`.
4. **Estimate the rest.** No-token installs match on hashed IP + OS within 30 minutes. `method='estimate'`, confidence below 1. See rule 1.

---

## The dashboard is arrangeable, not programmable

Widgets come from `WIDGET_CATALOGUE` in `packages/schema/src/widgets.ts`. Adding one means adding a **question worth answering**, with SQL written for it — not a new knob on a query builder.

**A generic explore view is the failure mode for this project.** Anything obtainable by pointing Grafana at the same Postgres in an afternoon does not belong here. That line is the catalogue.

One `snapshot()` call serves every card on a board: the layout is known before any SQL runs, so the queries are deduplicated up front rather than one per widget.

---

## Gotchas that cost real time

- **Solid needs `<HydrationScript />` from `solid-js/web` in the document head.** Without it nothing hydrates, in dev or production, and the failure surfaces as `Cannot read properties of undefined (reading 'done')` inside TanStack's client entry — a seroval stream error that names nothing Solid-related. It is in `src/routes/__root.tsx`. Do not remove it.
- **`postgres.js` cannot serialize a `Date` parameter under Bun** — it throws on every timestamp and returns timestamps as strings. The driver is `pg` for that reason, verified rather than assumed.
- **The production bundle inlines `db/`**, so `import.meta.url` points into `dist/server/`. Migrations, views and query files are located through `db/paths.ts`, with `FIRSTRUN_DB_DIR` as the override.
- **Vite plugin order is enforced**: `tanstackStart()` before `viteSolid()`. The reverse fails the build with an explicit message.
- **TanStack Start's build does not serve static assets.** `apps/web/server.ts` tries `dist/client` first, then falls through to SSR. Without it every `/assets/*` 404s in production while pages still render, which looks like a CSS bug and is not.
- `@tanstack/solid-start` is published as a **beta** on the Solid path, and pins its siblings to exact versions. Do not float them independently.

---

## Layout

```
apps/web/           TanStack Start (Solid): UI, auth, and the ingest routes
packages/schema/    event envelope, wire formats, widget catalogue
packages/identity/  person resolution — edges, overrides, squash
packages/ingest/    ingest handlers as plain Request -> Response
packages/web-tag/   ~1.5KB browser script, vanilla TS, esbuild
db/                 drizzle schema, migrations, analytics .sql, seed
sdk/tauri/          Rust crate: first-run claim + disk-backed event queue
```

`packages/identity` has no database dependency: it takes a store interface, and the memory implementation is the specification the Postgres one must match.

---

## Explicitly NOT in scope

Session replay · feature flags · experiments · minidumps or symbol upload · mobile SDKs · error tracking · billing · a generic explore or query builder.
