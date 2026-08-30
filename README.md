# firstrun

One structured log for everything you ship, self-hosted, with a query layer on top.

Point your marketing site, your desktop app, your mobile app and your backend at the same
firstrun. They all write into one table, under one project, on your own Postgres, with one
dashboard over the top.

An error is a log entry. A page view is a log entry. A latency sample is a log entry. They differ
in what they carry, never in where they go. The model is
[OpenTelemetry's log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/): a
timestamp, a severity on the 1..24 ladder, a name, and an attribute map.

Identity is an anonymous id per surface plus an optional `identify()`, and nothing is ever merged
or guessed. firstrun is never in your critical path: if it is down, your software is unaffected.

## Quick start

```bash
docker compose up -d      # postgres
bun install
bun run seed              # a synthetic workspace with believable data
bun run dev               # http://localhost:3000
```

`bun run seed` prints the workspace, the project and a command to sign in locally:

```bash
bun run dev:login seed
```

That prints a cookie to paste into the browser console. It exists because GitHub OAuth needs
credentials that development should not require: it is a CLI on the machine that owns the
database, deliberately not a route.

Migrations apply themselves on boot, so a clean clone needs nothing else.

## The row

Five columns carry meaning, and everything else lives in `attributes`:

| | |
|---|---|
| `project_id` | which project. Resolved from the source key, never sent |
| `time` | when it happened. Client-stamped and authoritative |
| `name` | what happened. Any string, no allowlist |
| `severity` | 1..24, the OpenTelemetry ladder. TRACE, DEBUG, INFO, WARN, ERROR, FATAL |
| `distinct_id` | the anonymous id that surface generated for itself |
| `attributes` | JSON. `os.type`, `url.path`, `user.id`, `exception.message`, and anything of yours |

`ingested_at` is stamped on arrival for debugging. Nothing sorts, buckets or retains on it.

The table is `PARTITION BY RANGE (time)`, so retention is dropping a partition rather than a bulk
delete, and every query prunes by range.

Attribute keys follow the OpenTelemetry semantic conventions where they exist and are namespaced
`firstrun.*` where they do not. They are **conventions, not law**: an entry is never rejected for
using its own keys, and it is stored, indexed and queried identically either way.

## Clients

| | |
|---|---|
| `@firstrun/web-tag` | the `<script>` tag. Vanilla, no dependencies, 4KB gzipped budget, consent-gated |
| `@firstrun/analytics` | npm wrapper for the tag: `/react`, `/next`, `/svelte`, `/vue`, `/astro` |
| `clients/node` | server-side JavaScript and TypeScript |
| `clients/python` | server-side Python |
| `clients/go` | server-side Go |
| `clients/dotnet` | .NET, including Windows desktop apps |
| `sdk/tauri` | Rust crate for Tauri desktop apps, with a disk-backed queue |

All of them offer the same calls: `init`, `event`, `error`, `log`, `identify`, `flush`. `event`
and `error` fill in a convention for you; `log` takes any entry you like. All of them are
fire-and-forget, bounded, and never throw into your program. They differ only in where the queue
lives and how the platform spawns a background thread. When they send is
[docs/delivery-policy.md](./docs/delivery-policy.md).

Ingest is one endpoint, `POST /v1/e`. Clients send a public source key (`fr_web_…`,
`fr_desktop_…`), never an internal id.

## How it is organised

```
workspace   who can see things, and who can change them (admin / read)
  project   one product. Owns entries, sources and dashboards
    source  one thing that writes entries, with a fixed surface
```

Surfaces are `web`, `desktop`, `mobile`, `server`, `other`. Sources in one project are reported
next to each other and are never identity-linked: each has its own anonymous `distinct_id` space.
To connect them, call `identify()` with the same user id on both.

## Dashboards

A widget is a **saved query plus a visualisation**. The query is a filter, a group by, an
aggregate, a time bucket and a limit, over the five columns and any attribute path. The templates
are starting points you then edit, not the set of questions the product can answer.

Attribute keys are **discovered rather than declared**: the pickers offer what has actually been
written in the visible range. There is no schema to register.

## Stack

| | |
|---|---|
| App | TanStack Start on Solid, one service |
| UI | shadcn on Tailwind v4, primitives from Kobalte |
| Store | Postgres: log entries, auth and configuration, partitioned by time |
| Schema | Drizzle owns the DDL; the analytics queries are compiled and parameter-bound |
| Deploy | Railway, one Dockerfile |

## Layout

```
apps/web/           UI, auth, the documentation, and the ingest endpoints
packages/schema/    log entry, severity, attributes, conventions, query and snapshot shapes
packages/ingest/    ingest handlers as plain Request -> Response
packages/web-tag/   the browser tag
packages/analytics/ npm package wrapping the tag, one subpath per framework
clients/            the SDK family: node, python, go, dotnet
sdk/tauri/          Rust crate: disk-backed entry queue
db/                 drizzle schema, migrations, partition maintenance, analytics .sql, seed
docs/               measured design references and the delivery policy
```

## Tests

```bash
bun test
cargo test --manifest-path sdk/tauri/Cargo.toml
```

The ones that matter:

- `packages/ingest/test/late-event.test.ts`: an entry stamped three days ago lands in the
  three-days-ago bucket. App entries arrive late, and `ingested_at` is never bucketed on.
- `packages/web-tag/test/consent.test.ts`: before consent, nothing is stored and nothing is sent.
- `packages/web-tag/test/size.test.ts`: the tag stays inside its gzipped budget.

The ingest tests need Postgres running. They do not skip when it is missing; they fail and say
why.

## Deploying to Railway

1. Add a **Postgres** service. Railway sets `DATABASE_URL`.
2. Point a service at this repo. `railway.json` selects the Dockerfile.
3. Set the variables:

   | Variable | Value |
   |---|---|
   | `PUBLIC_ORIGIN` | the service's public domain, e.g. `https://app.example.com` |
   | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | from a GitHub OAuth app whose callback is `<PUBLIC_ORIGIN>/auth/github/callback` |

`PUBLIC_ORIGIN` has to be externally reachable: it is what every client talks to.

Health check is `/v1/health`.

## Read this before changing anything

[CLAUDE.md](./CLAUDE.md). Eight rules in there are the ones that get broken by accident, and a
list of gotchas that each cost an afternoon.

## Licence

Proprietary. See [LICENSE](./LICENSE).
