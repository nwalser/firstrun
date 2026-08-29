# One image, one service: the dashboard and the ingest endpoints share a
# process because at this scale they share a database and a deploy cadence.
# The handlers are plain Request/Response functions, so splitting them into a
# second service later is a routing change rather than a rewrite.

FROM oven/bun:1.4 AS build
WORKDIR /app

# Manifests first, so a source-only change does not re-resolve the whole
# dependency graph.
COPY package.json bun.lock tsconfig.json ./
COPY apps/web/package.json apps/web/
COPY packages/schema/package.json packages/schema/
COPY packages/identity/package.json packages/identity/
COPY packages/ingest/package.json packages/ingest/
COPY packages/web-tag/package.json packages/web-tag/
COPY db/package.json db/
RUN bun install --frozen-lockfile

COPY . .

# The tag is built first: the server serves it from disk at /t.js, and its size
# budget fails the build rather than warning.
RUN bun run build:web-tag \
 && bun run check:size \
 && bun run --cwd apps/web build

FROM oven/bun:1.4 AS runtime
WORKDIR /app
ENV NODE_ENV=production

# The whole tree rather than a hand-picked subset. Bun's isolated installs are
# a lattice of symlinks into node_modules/.bun, and copying pieces of that
# across stages breaks resolution in ways that only show up at runtime.
COPY --from=build /app /app

# db/ holds the migrations, the views and the analytics .sql files. They are
# read at runtime, not bundled -- see db/paths.ts.
ENV FIRSTRUN_DB_DIR=/app/db

EXPOSE 3000
CMD ["bun", "run", "apps/web/server.ts"]
