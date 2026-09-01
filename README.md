# firstrun

**One place for everything your software has to tell you, running on your own database.**

Your marketing site, your desktop app, your mobile app and your backend all send to the same
firstrun. Crashes, sign-ups, page views, slow queries: they all land in one place, and you ask
questions across the lot of them from one dashboard.

Most teams end up with an analytics tool, a crash reporter, a product-events tool and a log
search, each holding a quarter of the story and none of them able to answer "did the release that
crashed on Tuesday cost us sign-ups". firstrun is the other approach: everything goes to the same
place, and the question is just a query.

- **Self-hosted and free.** Every feature, no ceilings, no licence key, nothing phoning home.
  There is also a hosted version, which is the thing being sold.
- **Never in your way.** If firstrun is down, your app and your site carry on exactly as normal.
  Nobody notices. Every client drops data before it delays anything a person is waiting on.
- **Your data stays yours.** One Postgres you control. No third party, no data sharing, no
  cross-site tracking, and the browser tag sends nothing at all before consent.

## Try it

```bash
docker compose up -d      # postgres
bun install
bun run seed              # a demo workspace with believable data in it
bun run dev               # http://localhost:3000
```

`bun run seed` prints a command that signs you in locally, so you do not need to set up GitHub
OAuth to look around:

```bash
bun run dev:login seed
```

Database migrations run themselves on boot, so a fresh clone needs nothing else.

## Sending things to it

Add a site to it with a script tag. Page views, sessions, time on page, outbound clicks and Core
Web Vitals are measured for you:

```html
<script async src="https://t.example.com/t.js" data-key="fr_9f3a2b1c4d5e6f70"></script>
```

Add a server, a desktop app or anything else with one of the clients:

```ts
import { Firstrun } from "@firstrun/node";

const firstrun = new Firstrun({
  sourceKey: process.env.FIRSTRUN_SOURCE_KEY!,
  host: "https://t.example.com",
});

firstrun.event("invoice_generated", { plan: account.plan }, { userId: account.id });
firstrun.error(err);
```

| | |
|---|---|
| `@firstrun/web-tag` | the script tag. No dependencies, under 5KB, consent-gated |
| `@firstrun/analytics` | npm wrapper for the tag: `/react`, `/next`, `/svelte`, `/vue`, `/astro` |
| `clients/node` `clients/python` `clients/go` `clients/dotnet` | the server and desktop SDKs |
| `sdk/tauri` | Rust crate for Tauri apps, with a queue that survives a restart |

They all offer the same handful of calls (`event`, `error`, `log`, `user`, `device`, `session`,
`flush`), so reading one means you have read all of them. All of them queue in the background, bound what they
hold, and never throw into your program. An entry stamped three days ago on a laptop that was
offline still lands on the right day when it finally arrives.

## Asking it things

A card on a dashboard is a saved question plus a way of drawing the answer, and the question has
five parts: what to filter on, what to group by, what to count, how wide the time buckets are,
and how many groups to show. Anything you can express that way, you can build in the UI by
clicking. The templates are starting points to edit, not the limit of what can be asked.

You never register a schema. The pickers offer whatever has actually been sent in the range you
are looking at, so a new attribute shows up as soon as something writes one.

Boards are arranged by dragging: cards keep their size and position, every edit saves itself, and
each board carries its own filters, date range and comparison window.

## A little of how it works

Everything is stored as one kind of row, following
[OpenTelemetry's log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/). Four
things are promoted to columns:

| | |
|---|---|
| `project_id` | which project. Taken from the key it arrived under, never from the body |
| `time` | when it happened, according to whatever sent it |
| `name` | what happened. Any string you like, no allowlist |
| `severity` | 1..24: TRACE, DEBUG, INFO, WARN, ERROR, FATAL |

Everything else (`os.type`, `url.path`, `exception.message`, whatever else you send) lives in an
open JSON map and is queried by path. Keys follow the OpenTelemetry conventions where they exist,
but they are conventions rather than rules: your own keys are stored, indexed and queried
identically.

Identity is deliberately dull, and it lives in that map like everything else. Three optional
fields, set by `user()`, `device()` and `session()`, and an event may carry none of them. Nothing
is inferred: a browser has no device to find out, a server process is not a person, and a client
that was not told simply reports nothing rather than making something up. Each source has its own
id space, nothing is ever merged or matched, and the only way a person is joined across two of
them is you calling `user()` with the same id on both.

Things are organised **workspace** (who can see and change things) > **project** (one product) >
**source** (one thing that writes).

## Running it for real

Deploy to [Railway](https://railway.app): add a Postgres service, point a service at this repo,
and set `PUBLIC_ORIGIN` to the public domain plus `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`
from a GitHub OAuth app whose callback is `<PUBLIC_ORIGIN>/auth/github/callback`. `railway.json`
picks the Dockerfile up, and the health check is `/v1/health`.

`PUBLIC_ORIGIN` has to be reachable from outside: it is the address every client talks to.

## Working on it

Built with TanStack Start on Solid, shadcn on Tailwind, and Postgres for all of it, deployed as
one service from one Dockerfile.

```
apps/web/           the UI, auth, the docs, and the endpoint everything sends to
packages/schema/    the shared contract: entries, attributes, queries, boards
packages/ingest/    the ingest handlers
packages/web-tag/   the browser tag
packages/analytics/ npm package wrapping the tag, one subpath per framework
clients/            node, python, go, dotnet
sdk/tauri/          Rust crate for Tauri apps
db/                 schema, migrations, the query compiler, seed data
docs/               design references, the delivery policy, billing
```

```bash
bun test
bun run typecheck
```

The tests worth knowing about pin down the promises above: a late entry lands on the day it
happened, the tag sends nothing before consent, and the tag stays inside its size budget. Ingest
tests need Postgres up, and say so rather than skipping.

**Read [CLAUDE.md](./CLAUDE.md) before changing anything.** It has the nine rules that get broken
by accident and a list of gotchas that each cost an afternoon.

## Licence

Proprietary. See [LICENSE](./LICENSE).
