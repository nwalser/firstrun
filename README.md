# firstrun

Analytics that joins a **website visitor** to an **app installation** as the same person.

```
visit → download → install → first run → activated → paying
```

PostHog has no install identity and no version model. Sentry has no retention. Plausible and Aptabase have no identity at all. Nobody draws that line end to end. This does.

Milestone 1 builds only the join, plus one screen that shows it.

## Quick start

```bash
docker compose up -d      # clickhouse only
bun install
bun run seed              # ~3,400 visitors -> 19 purchases of synthetic data
bun run dev               # ingest on :4318, dashboard on :3000
```

Migrations apply themselves on boot, so `bun run dev` works on a clean clone.
`bun run migrate` runs them without starting a server.

Then open the funnel:

```
http://localhost:3000/projects/<project-id>/funnel
```

`bun run seed` prints the project id it created.

## Layout

```
apps/ingest/       Bun + Hono: /v1/e, /v1/download, /dl/:token/:file, /v1/claim
apps/dashboard/    Next.js: exactly one page
packages/schema/   shared TS types + zod for the event envelope
packages/identity/ person resolution — edges, overrides, squash
packages/web-tag/  ~2KB browser script, vanilla TS, esbuild
sdk/tauri/         Rust crate: first-run claim + event send
db/clickhouse/     numbered .sql migrations
db/sqlite/         numbered .sql migrations
db/seed.ts         synthetic project generator
```

## Tests

```bash
bun test
```

The ones that matter:

- `packages/identity/test/estimate-never-mutates.test.ts` — an `estimate` edge must never change a `person_id`.
- `apps/ingest/test/join-e2e.test.ts` — visitor → token → claim resolves to **one** person carrying both ids, counted once in the funnel.
- `apps/ingest/test/late-event.test.ts` — an event stamped three days ago lands in the three-days-ago bucket.
- `apps/ingest/test/estimate-e2e.test.ts` — an untokened install is matched, reported as its own number, and still resolves to a different person.
- `packages/web-tag/test/consent.test.ts` — before consent, nothing is stored and nothing is sent.
- `packages/web-tag/test/size.test.ts` — the tag stays under 3KB gzipped. Also enforced in CI.

The ingest tests need ClickHouse running. They do not skip when it is missing;
they fail and say so.

```bash
cargo test --manifest-path sdk/tauri/Cargo.toml
```

## Read this before changing anything

[CLAUDE.md](./CLAUDE.md). Three rules in there are the ones that get broken by accident.

## Licence

Proprietary. See [LICENSE](./LICENSE).
