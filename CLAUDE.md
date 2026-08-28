# CLAUDE.md — firstrun

## What this is

An analytics backend whose one differentiating capability is **joining a website visitor to an app installation as the same person**.

```
visit → download → install → first run → activated → paying
```

Every existing tool owns one segment and breaks at the handoffs. **The handoff is the product.** Everything else is table stakes.

First real subject: Themia — a Tauri Windows desktop app with a marketing site, ~1,000 monthly users, ~40 paying customers. Design for that shape.

---

## The three rules a future session will otherwise get wrong

### 1. Exact joins mutate `person_id`. Estimated joins never do.

- `method='token'` and `method='account'` are **exact**. They write an `identity_edge`, write `person_overrides`, and change which person an event belongs to.
- `method='estimate'` writes an `identity_edge` **and nothing else**. It never writes `person_overrides`, never touches `events.person_id`, and is never followed by `resolve()`.
- Estimated edges are read only by aggregate funnel queries, which must return exact and estimated counts as **two separate numbers**, labelled.
- `packages/identity/test/estimate-never-mutates.test.ts` fails if this is ever violated. Do not weaken it.

### 2. `event_time` and `ingest_time` are separate and both required.

- `event_time` is client-stamped and **authoritative**. App events arrive hours or days late — a laptop is offline, the OS kills the process, the queue replays on next launch.
- `ingest_time` is server-stamped and exists for debugging and dedup windows only.
- **Never sort, bucket, window, or retain on `ingest_time`.** Every funnel, retention, and day-bucket query uses `event_time`.

### 3. `person_id` is derived. A client never sends one.

- Clients send distincts: `web_visitor_id`, `install_id`, `account_id`.
- `person_id` is computed server-side by `packages/identity` and nothing else computes it.
- Seed identity: `person_id = uuidv5(NS, "<project_id>:<type>:<id>")`. Deterministic, so a distinct that has never been joined still has a stable person.
- Canonical person for a merged component = **lowest UUID** among the component's seed ids.

---

## Decisions already made — do not relitigate

| Decision | Choice |
|---|---|
| Ingest + API | TypeScript on Bun, Hono for HTTP |
| Dashboard | Next.js (App Router) |
| Event store | ClickHouse |
| Transactional store | SQLite via `bun:sqlite` for projects, download tokens, auth. Becomes Postgres later — keep queries behind a thin repository layer |
| Wire format | OTLP-shaped internally. The web tag sends a compact custom body normalized at the edge |
| Deployment | Cloud-first. Keep it self-host-shaped (docker compose, no managed-service dependencies) |
| Web identity | Identified, consent-gated. Persistent visitor ID, no cookies set before consent |

Everything runs locally with `docker compose up` + `bun run dev`. No cloud accounts required to develop.

---

## The join

1. **Mint on download.** `GET /v1/download?project&asset&vid` mints an 8-char Crockford base32 token from 5 random bytes, 7-day expiry, and `302`s to `/dl/<token>/<Asset>-<version>-<token>.exe`. **The token lives in the filename.**
2. **Claim on first run.** NSIS hook reads the installer's own `$EXEPATH` and writes the token to `%LOCALAPPDATA%\<App>\install_token`. Fallback: scan Downloads for `*-([0-9A-HJKMNP-TV-Z]{8}).exe`, newest wins. Then `POST /v1/claim` once, then delete the token file.
3. **Confirm on login.** An `account_id` on either surface supersedes. `method='account'`.
4. **Estimate the rest.** No-token installs (store, winget, shared link) match on IP + OS + a 30-minute first-run window. `method='estimate'`, confidence < 1. See rule 1.

---

## Naming

The product name is confined to:
- the repo name,
- `@firstrun/*` package names,
- the single `PRODUCT_NAME` constant in `packages/schema/src/product.ts`.

Do not sprinkle it through code or copy. Renaming should be one find-and-replace.

---

## Build order

`packages/identity` → ClickHouse migrations → ingest endpoints → seed → web tag → Tauri SDK → dashboard page.

Identity resolution is test-first. Everything else: tests alongside, not at the end.

---

## Explicitly NOT in milestone 1

Session replay · feature flags · experiments · minidumps or symbol upload · mobile SDKs · error tracking of any kind · self-hosting docs · billing · a generic explore or query builder · multi-tenant auth beyond a single API key per project.

**The generic explore view is the failure mode for this project.** If a feature could be had by pointing Grafana at the same ClickHouse in an afternoon, it does not belong here.
