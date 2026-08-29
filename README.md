# firstrun

Analytics that joins a **website visitor** to an **app installation** as the same person.

```
visit → download → install → first run → activated → paying
```

PostHog has no install identity and no version model. Sentry has no retention. Plausible and Aptabase have no identity at all. Nobody draws that line end to end. This does.

## Quick start

```bash
docker compose up -d      # postgres
bun install
bun run seed              # a synthetic workspace with believable data
bun run dev               # http://localhost:3000
```

`bun run seed` prints the workspace and a command to sign in locally:

```bash
bun run dev:login seed
```

That prints a cookie to paste into the browser console. It exists because GitHub
OAuth needs credentials that development should not require — it is a CLI on the
machine that owns the database, deliberately not a route.

Migrations apply themselves on boot, so a clean clone needs nothing else.

## Stack

| | |
|---|---|
| App | TanStack Start on Solid, one service |
| Store | Postgres — events, identity, auth and configuration |
| Schema | Drizzle owns the DDL; the analytics queries are hand-written `.sql` |
| Deploy | Railway, one Dockerfile |

## Layout

```
apps/web/           UI, auth, and the ingest endpoints
packages/schema/    event envelope, wire formats, widget catalogue
packages/identity/  person resolution — edges, overrides, squash
packages/ingest/    ingest handlers as plain Request -> Response
packages/web-tag/   ~1.5KB browser script
db/                 drizzle schema, migrations, analytics .sql, seed
sdk/tauri/          Rust crate: first-run claim + disk-backed queue
```

## The join

1. **Mint on download.** `/v1/download` mints a token and redirects to an installer whose *filename carries it*.
2. **Claim on first run.** An NSIS hook reads the installer's own path; failing that the app scans Downloads. Then one `POST /v1/claim`.
3. **Confirm on login.** A shared `account_id` supersedes everything.
4. **Estimate the rest.** No-token installs match on hashed IP + OS within 30 minutes — reported as its own number, never merged into a person.

## Tests

```bash
bun test
cargo test --manifest-path sdk/tauri/Cargo.toml
```

The ones that matter:

- `packages/identity/test/estimate-never-mutates.test.ts` — a guess never changes who anybody is.
- `packages/ingest/test/join-e2e.test.ts` — visitor → token → claim resolves to **one** person across two sources, counted once.
- `packages/ingest/test/late-event.test.ts` — an event stamped three days ago lands in the three-days-ago bucket.
- `packages/ingest/test/estimate-e2e.test.ts` — an untokened install is matched, reported separately, and stays a different person.
- `packages/web-tag/test/consent.test.ts` — before consent, nothing is stored and nothing is sent.
- `packages/web-tag/test/size.test.ts` — the tag stays under 3KB gzipped.

The ingest tests need Postgres running. They do not skip when it is missing;
they fail and say why.

## Deploying to Railway

1. Add a **Postgres** service. Railway sets `DATABASE_URL`.
2. Point a service at this repo — `railway.json` selects the Dockerfile.
3. Set the variables:

   | Variable | Value |
   |---|---|
   | `PUBLIC_ORIGIN` | the service's public domain, e.g. `https://app.example.com` |
   | `IP_HASH_SALT` | `openssl rand -hex 32`, stable forever |
   | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | from a GitHub OAuth app whose callback is `<PUBLIC_ORIGIN>/auth/github/callback` |
   | `ASSET_ORIGIN` | where real installers are served from (optional) |

`PUBLIC_ORIGIN` has to be externally reachable: it is what the download
redirect, the web tag and the desktop SDK all talk to.

Health check is `/v1/health`.

## Read this before changing anything

[CLAUDE.md](./CLAUDE.md). Four rules in there are the ones that get broken by
accident, and a list of gotchas that each cost an afternoon.

## Licence

Proprietary. See [LICENSE](./LICENSE).
