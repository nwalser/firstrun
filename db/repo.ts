import { createHash, randomBytes } from "node:crypto";
import { and, eq, gte, lt, ne, sql as raw, type SQL } from "drizzle-orm";
import {
  defaultBoard,
  mintSourceKey,
  parseBoard,
  type Board,
} from "@firstrun/schema";
import { ATTR } from "@firstrun/schema/conventions";
import type { Database } from "./client.js";
import {
  dashboards,
  logEntries,
  projects,
  sessions,
  sources,
  users,
  workspaceMembers,
  workspaces,
  type Dashboard,
  type MemberRole,
  type Project,
  type Source,
  type User,
  type Workspace,
} from "./schema.js";

/**
 * Everything that is not an analytics query.
 *
 * Grouped by the thing it is about rather than by table, so a caller asks for
 * "the projects this user can see" instead of assembling a join. Drizzle
 * handles the SQL; what lives here is the intent.
 */

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The cookie holds the plaintext token; the database holds its SHA-256.
 *
 * A leaked database backup should not be a set of working session cookies. The
 * token is high-entropy random, so a plain hash is enough -- there is nothing to
 * brute force and no need for a slow KDF here.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface NewSession {
  /** Put this in the cookie. It is never stored. */
  token: string;
  expiresAt: Date;
}

export async function createSession(db: Database, userId: string): Promise<NewSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function userForSession(db: Database, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const rows = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gte(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0]?.user ?? null;
}

export async function deleteSession(db: Database, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function pruneSessions(db: Database): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export interface GithubProfile {
  githubId: number;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * Keyed on GitHub's numeric id, not the login.
 *
 * Logins are renameable and reusable: someone who changes their username should
 * keep their workspaces, and someone who claims a freed-up username should
 * absolutely not inherit them.
 */
export async function upsertGithubUser(db: Database, profile: GithubProfile): Promise<User> {
  const rows = await db
    .insert(users)
    .values(profile)
    .onConflictDoUpdate({
      target: users.githubId,
      set: {
        login: profile.login,
        name: profile.name,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
      },
    })
    .returning();
  return rows[0]!;
}

// ---------------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "untitled";
}

/**
 * Collisions are suffixed rather than rejected.
 *
 * The name belongs to the user; the slug belongs to us. Refusing "Themia"
 * because someone else already took it would be our implementation detail
 * leaking into their form.
 */
async function uniqueSlug(
  taken: (slug: string) => Promise<boolean>,
  name: string
): Promise<string> {
  const base = slugify(name);
  let slug = base;
  for (let n = 2; await taken(slug); n++) slug = `${base}-${n}`;
  return slug;
}

// ---------------------------------------------------------------------------
// Workspaces and access
// ---------------------------------------------------------------------------

export interface WorkspaceWithRole extends Workspace {
  role: MemberRole;
}

/** Selecting the bytes on every page load would be wasteful; the stamp is enough. */
export const workspaceColumns = {
  id: workspaces.id,
  name: workspaces.name,
  slug: workspaces.slug,
  logoUpdatedAt: workspaces.logoUpdatedAt,
  createdAt: workspaces.createdAt,
};

export async function listWorkspaces(db: Database, userId: string): Promise<WorkspaceWithRole[]> {
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaces.createdAt);
  return rows.map((r) => ({ ...r.workspace, role: r.role }));
}

/**
 * Access is checked here, not by the caller.
 *
 * Every route that loads a workspace or a project goes through this file, so
 * "can this person see this" has one answer in one place. A route that forgets
 * gets `null` and renders a not-found, which is the safe direction to fail in.
 */
export async function workspaceForUser(
  db: Database,
  slug: string,
  userId: string
): Promise<WorkspaceWithRole | null> {
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId))
    )
    .where(eq(workspaces.slug, slug))
    .limit(1);
  const row = rows[0];
  return row ? { ...row.workspace, role: row.role } : null;
}

export async function createWorkspace(
  db: Database,
  name: string,
  ownerId: string
): Promise<Workspace> {
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(async (candidate) => {
      const hit = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, candidate))
        .limit(1);
      return hit.length > 0;
    }, name);

    const created = (await tx.insert(workspaces).values({ name, slug }).returning())[0]!;
    // Whoever creates it can change it. Everyone invited later starts at read.
    await tx.insert(workspaceMembers).values({
      workspaceId: created.id,
      userId: ownerId,
      role: "admin",
    });
    return created;
  });
}

/**
 * Renames a workspace and re-slugs it, returning the slug to redirect to.
 *
 * The URL moves. That is the deliberate choice: a slug that no longer resembles
 * the name is a worse surprise than a stale bookmark, and there is exactly one
 * of these per workspace so there is nothing to keep in sync.
 */
export async function renameWorkspace(
  db: Database,
  workspaceId: string,
  name: string
): Promise<string> {
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(async (candidate) => {
      const hit = await tx
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(and(eq(workspaces.slug, candidate), ne(workspaces.id, workspaceId)))
        .limit(1);
      return hit.length > 0;
    }, name);
    await tx.update(workspaces).set({ name, slug }).where(eq(workspaces.id, workspaceId));
    return slug;
  });
}

/**
 * Removes a workspace, its projects, their sources and dashboards, and every
 * log entry underneath. There is no undo.
 *
 * The entries have to be deleted EXPLICITLY. `log_entries` carries no foreign
 * key to `projects`, because a partitioned table's key puts the trigger on
 * every partition and this is the largest table in the database. The cost of
 * that decision is paid here and in `deleteProject`: nothing cascades, so a
 * delete that forgets leaves entries nobody can see and nobody can remove,
 * counted forever against the storage a customer is paying for.
 *
 * One transaction, so a failure between the two statements is not a workspace
 * that is half gone.
 */
export async function deleteWorkspace(db: Database, workspaceId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(logEntries).where(
      raw`${logEntries.projectId} IN (
            select ${projects.id} from ${projects}
             where ${projects.workspaceId} = ${workspaceId}
          )`
    );
    await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });
}

/**
 * The workspace logo.
 *
 * Stored as bytes, served from `/api/logo/:slug`, and cache-busted with
 * `logoUpdatedAt` so a replaced logo shows up immediately without the URL
 * changing. The image is downscaled client-side before it gets here, so the
 * only server-side limit is a backstop against something pathological.
 */
export const MAX_LOGO_BYTES = 512 * 1024;

export async function setWorkspaceLogo(
  db: Database,
  workspaceId: string,
  bytes: Buffer,
  mimeType: string
): Promise<{ ok: true } | { error: string }> {
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    return { error: `That image is too large (max ${Math.round(MAX_LOGO_BYTES / 1024)}KB).` };
  }
  // No SVG. An SVG is a document that can carry script, and this one would be
  // served from our own origin -- so an uploaded logo would be same-origin
  // JavaScript running against a signed-in session. Raster only.
  if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) {
    return { error: "Logos must be a PNG, JPEG or WebP." };
  }
  await db
    .update(workspaces)
    .set({ logo: bytes, logoMimeType: mimeType, logoUpdatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
  return { ok: true };
}

export async function clearWorkspaceLogo(db: Database, workspaceId: string): Promise<void> {
  await db
    .update(workspaces)
    .set({ logo: null, logoMimeType: null, logoUpdatedAt: null })
    .where(eq(workspaces.id, workspaceId));
}

/** Public: a logo is not a secret, and the serving route has no session. */
export async function workspaceLogo(
  db: Database,
  slug: string
): Promise<{ bytes: Buffer; mimeType: string; updatedAt: Date } | null> {
  const rows = await db
    .select({
      logo: workspaces.logo,
      mimeType: workspaces.logoMimeType,
      updatedAt: workspaces.logoUpdatedAt,
    })
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);

  const row = rows[0];
  if (!row?.logo || !row.mimeType) return null;
  return { bytes: row.logo, mimeType: row.mimeType, updatedAt: row.updatedAt ?? new Date(0) };
}

/**
 * A project's picture: the same three columns, the same rules.
 *
 * Deliberately the workspace pair again rather than one function over a table
 * name. The two differ in how they are ADDRESSED -- a workspace by its slug, a
 * project by a workspace slug and a project slug -- and a shared helper that
 * took a table would have to take that difference as a parameter anyway.
 *
 * The size and format checks are the same because the reasons are the same,
 * SVG included: it is served from our own origin, so an uploaded one would be
 * same-origin script running against a signed-in session.
 */
export async function setProjectLogo(
  db: Database,
  projectId: string,
  bytes: Buffer,
  mimeType: string
): Promise<{ ok: true } | { error: string }> {
  if (bytes.byteLength > MAX_LOGO_BYTES) {
    return { error: `That image is too large (max ${Math.round(MAX_LOGO_BYTES / 1024)}KB).` };
  }
  if (!/^image\/(png|jpeg|webp)$/.test(mimeType)) {
    return { error: "Logos must be a PNG, JPEG or WebP." };
  }
  await db
    .update(projects)
    .set({ logo: bytes, logoMimeType: mimeType, logoUpdatedAt: new Date() })
    .where(eq(projects.id, projectId));
  return { ok: true };
}

export async function clearProjectLogo(db: Database, projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ logo: null, logoMimeType: null, logoUpdatedAt: null })
    .where(eq(projects.id, projectId));
}

/**
 * Public, and joined on the workspace: project slugs are only unique inside one.
 *
 * No session, like the workspace one. A picture somebody chose for a product is
 * not a secret, and the alternative is an authenticated image URL, which no
 * `<img>` on a page rendered for a different reader would be able to load.
 */
export async function projectLogo(
  db: Database,
  workspaceSlug: string,
  projectSlug: string
): Promise<{ bytes: Buffer; mimeType: string; updatedAt: Date } | null> {
  const rows = await db
    .select({
      logo: projects.logo,
      mimeType: projects.logoMimeType,
      updatedAt: projects.logoUpdatedAt,
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .where(and(eq(workspaces.slug, workspaceSlug), eq(projects.slug, projectSlug)))
    .limit(1);

  const row = rows[0];
  if (!row?.logo || !row.mimeType) return null;
  return { bytes: row.logo, mimeType: row.mimeType, updatedAt: row.updatedAt ?? new Date(0) };
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface MemberRow {
  userId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  role: MemberRole;
}

export async function listMembers(db: Database, workspaceId: string): Promise<MemberRow[]> {
  const rows = await db
    .select({ user: users, role: workspaceMembers.role, createdAt: workspaceMembers.createdAt })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, workspaceId))
    .orderBy(workspaceMembers.createdAt);
  return rows.map((r) => ({
    userId: r.user.id,
    login: r.user.login,
    name: r.user.name,
    avatarUrl: r.user.avatarUrl,
    role: r.role,
  }));
}

/** Invite by GitHub login. The user must have signed in here at least once. */
export async function addMemberByLogin(
  db: Database,
  workspaceId: string,
  login: string,
  role: MemberRole
): Promise<{ ok: true } | { error: string }> {
  const found = await db.select().from(users).where(eq(users.login, login)).limit(1);
  const user = found[0];
  if (!user) {
    return {
      error: `No account for "${login}" yet. They have to sign in once before they can be added.`,
    };
  }
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId: user.id, role })
    .onConflictDoUpdate({
      target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      set: { role },
    });
  return { ok: true };
}

export async function setMemberRole(
  db: Database,
  workspaceId: string,
  userId: string,
  role: MemberRole
): Promise<{ ok: true } | { error: string }> {
  if (role !== "admin" && (await isLastAdmin(db, workspaceId, userId))) {
    return { error: "A workspace needs at least one admin." };
  }
  await db
    .update(workspaceMembers)
    .set({ role })
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
    );
  return { ok: true };
}

export async function removeMember(
  db: Database,
  workspaceId: string,
  userId: string
): Promise<{ ok: true } | { error: string }> {
  if (await isLastAdmin(db, workspaceId, userId)) {
    return { error: "A workspace needs at least one admin." };
  }
  await db
    .delete(workspaceMembers)
    .where(
      and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
    );
  return { ok: true };
}

/**
 * Guards the one irreversible mistake this model allows: demoting or removing
 * the only admin, which leaves a workspace nobody can administer.
 */
async function isLastAdmin(db: Database, workspaceId: string, userId: string): Promise<boolean> {
  const admins = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "admin")));
  return admins.length === 1 && admins[0]!.userId === userId;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * A project without its picture.
 *
 * Nothing above this file wants the bytes: every caller either draws the image
 * by URL or does not draw it at all, and the serving route reads the one row it
 * is asked for. Selecting the whole table instead would put every project's
 * image into the workspace list, which is a page that draws none of them.
 */
export const projectColumns = {
  id: projects.id,
  workspaceId: projects.workspaceId,
  name: projects.name,
  slug: projects.slug,
  logoUpdatedAt: projects.logoUpdatedAt,
  createdAt: projects.createdAt,
};

export type ProjectMeta = Omit<Project, "logo" | "logoMimeType">;

export interface ProjectWithRole extends ProjectMeta {
  /** The role the current user holds in the owning workspace. */
  role: MemberRole;
  workspaceSlug: string;
  workspaceName: string;
  workspaceLogoUpdatedAt: Date | null;
}

export interface ProjectStats extends ProjectMeta {
  sourceCount: number;
  /** Newest entry `time` across the project, or null if nothing has arrived. */
  lastEventAt: Date | null;
}

/**
 * The projects of a workspace, with enough to draw a card for each.
 *
 * Two correlated subqueries rather than two joins: joining `sources` and
 * `log_entries` in one statement multiplies the rows together, and the count of
 * sources comes back multiplied by the number of entries. That is the classic
 * way to make a workspace with one source and forty thousand entries report
 * forty thousand sources.
 *
 * `lastEventAt` reads `time`, never `ingested_at` -- see CLAUDE.md rule 5. An
 * app that was launched on Tuesday and uploaded its queue on Friday was last
 * used on Tuesday, and "last activity" on a card that said Friday would be
 * quietly wrong.
 *
 * `max(time)` over a partitioned table with no time predicate touches every
 * partition, which is the price of the question: "when did anything last
 * happen" cannot be answered from one month. It is one card on one page, and
 * each partition answers it from the primary key rather than by scanning.
 */
export async function listProjectsWithStats(
  db: Database,
  workspaceId: string
): Promise<ProjectStats[]> {
  const rows = await db
    .select({
      project: projectColumns,
      // The outer reference is spelled `"projects"."id"` rather than
      // interpolated. Drizzle renders `${projects.id}` inside a subquery as a
      // BARE `"id"`, which the subquery then resolves in its own scope: against
      // `sources` that is `sources.id`, so the correlation silently became
      // `sources.project_id = sources.id` and every project reported zero
      // sources. It is only a live bug where the inner table happens to have a
      // column of the same name, which is exactly what makes it worth spelling
      // out in both of these rather than in the one that broke.
      sourceCount: raw<number>`(
        select count(*)::int from ${sources}
         where ${sources.projectId} = "projects"."id"
      )`,
      // Typed as the string Postgres actually sends. Drizzle applies a column's
      // decoder to a column, not to an expression inside `sql`, so this comes
      // back as text however the driver would have parsed the column itself --
      // declaring it `Date` here compiles and then fails at runtime on the
      // first `.toISOString()`.
      lastEventAt: raw<string | null>`(
        select max(${logEntries.time}) from ${logEntries}
         where ${logEntries.projectId} = "projects"."id"
      )`,
    })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(projects.createdAt);

  return rows.map((r) => ({
    ...r.project,
    sourceCount: Number(r.sourceCount ?? 0),
    lastEventAt: r.lastEventAt ? new Date(r.lastEventAt) : null,
  }));
}

/**
 * How many daily buckets a list draws under each of its rows.
 *
 * One constant for both rollups below, because the workspace list and the
 * sources list draw the SAME chart at two scopes, and a reader comparing them
 * would be comparing two different windows if these ever drifted apart.
 */
export const INGEST_HISTOGRAM_DAYS = 30;

/** Midnight UTC of the day a moment falls in. */
function utcDayStart(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/**
 * The window a thirty-day rollup runs over.
 *
 * `until` is exclusive and a whole day past the last bucket, so today is counted
 * in full as it fills rather than cut off at the moment the page happened to
 * open.
 */
export function histogramWindow(now = new Date()): { from: Date; until: Date } {
  const today = utcDayStart(now);
  return {
    from: new Date(today.getTime() - (INGEST_HISTOGRAM_DAYS - 1) * DAY_MS),
    until: new Date(today.getTime() + DAY_MS),
  };
}

/**
 * The day bucket both rollups group on, spelled once.
 *
 * `AT TIME ZONE 'UTC'` on both sides, never a bare `date_trunc` over a
 * timestamptz: that truncates in whatever the SERVER's TimeZone happens to be,
 * so the same query buckets differently on a machine set to Europe/Zurich and
 * the bars land on the wrong days by a few hours. Out and back again keeps the
 * result a timestamptz, which `pg` hands back as a real instant.
 */
const utcDayBucket = raw`(date_trunc('day', ${logEntries.time} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`;

/**
 * A daily series read back as a rate: entries per hour over the same window.
 *
 * Divided by the hours that have actually ELAPSED in the window, not by
 * `30 * 24`. The last bucket is today and today is not over, so the fixed
 * divisor would quietly report a rate up to a full day's worth low, and worst
 * on a project whose first entries arrived this morning.
 *
 * Derived from the series rather than counted again, so the number and the bars
 * beside it are always the same measurement: a rate that disagreed with the
 * chart it sits under would be a bug nobody could see.
 */
export function entriesPerHour(daily: readonly number[], now = new Date()): number {
  const { from } = histogramWindow(now);
  const hours = Math.max(1, (now.getTime() - from.getTime()) / 3_600_000);
  return daily.reduce((sum, n) => sum + n, 0) / hours;
}

/** One set of `(key, day, count)` rows, folded into a zero-filled array per key. */
function foldDaily(
  rows: readonly { key: string | null; day: string; n: string | number }[],
  from: Date,
  out: Map<string, number[]>
): Map<string, number[]> {
  for (const row of rows) {
    const series = row.key === null ? undefined : out.get(row.key);
    if (!series) continue;
    // `date_trunc` is an expression, so this arrives however `pg` parsed it
    // rather than through the column's decoder -- the same trap as `max(time)`.
    const index = Math.floor((new Date(row.day).getTime() - from.getTime()) / DAY_MS);
    if (index >= 0 && index < series.length) series[index] = Number(row.n);
  }
  return out;
}

/**
 * Entries per day per project, for the last thirty days.
 *
 * One statement for the whole workspace rather than one per project: this draws
 * a bar chart under every row of a list, and a query per row is a query per row.
 *
 * Bucketed on `time`, never `ingested_at` (rule 5), so a desktop app that
 * uploaded a week of queued entries this morning draws them on the days it was
 * actually used rather than as a spike today.
 *
 * Buckets are UTC days rather than the reader's local ones. The chart carries no
 * axis and no labels, so a few hours of drift moves nothing a reader can see,
 * and the alternative is threading a timezone from the browser through a loader
 * that runs before hydration. A dashboard card, which does label its axis, goes
 * through the query compiler and buckets in the reader's zone.
 *
 * Every project asked for gets an array of exactly `INGEST_HISTOGRAM_DAYS`
 * numbers, oldest first, zero-filled: a project that has sent nothing draws a
 * flat chart rather than no chart, which is an answer to "is this receiving
 * anything" rather than the absence of one.
 */
export async function projectDailyCounts(
  db: Database,
  workspaceId: string,
  projectIds: readonly string[]
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (const id of projectIds) out.set(id, new Array<number>(INGEST_HISTOGRAM_DAYS).fill(0));
  if (projectIds.length === 0) return out;

  const { from, until } = histogramWindow();

  const rows = await db.execute<{ key: string | null; day: string; n: string | number }>(raw`
    select ${logEntries.projectId} as key,
           ${utcDayBucket}         as day,
           count(*)::int           as n
      from ${logEntries}
     where ${logEntries.projectId} IN (
             select ${projects.id} from ${projects}
              where ${projects.workspaceId} = ${workspaceId}
           )
       and ${logEntries.time} >= ${from}
       and ${logEntries.time} <  ${until}
     group by 1, 2
  `);

  return foldDaily(rows.rows, from, out);
}

/**
 * The same thirty days, per SOURCE, across a whole workspace.
 *
 * The sibling of `projectDailyCounts`, and one statement for the same reason: a
 * chart under every row of a list must not be a query per row.
 *
 * It groups on `attributes ->> 'firstrun.source.id'` rather than on a column,
 * because that is where a source lives (rule 3, and the edge is what stamps it).
 * A GIN index does not answer a group by, so this is a scan of the window --
 * which is the trade rule 3 makes, bounded here by thirty days and by the
 * workspace. If it ever stops being cheap enough the answer is the generated
 * column rule 3 leaves room for, not a second write path.
 *
 * Entries carrying no source id are skipped rather than pooled: they are the
 * ones written before the edge stamped one, and there is no row here for them to
 * land on.
 */
export async function sourceDailyCounts(
  db: Database,
  workspaceId: string,
  sourceIds: readonly string[]
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (const id of sourceIds) out.set(id, new Array<number>(INGEST_HISTOGRAM_DAYS).fill(0));
  if (sourceIds.length === 0) return out;

  const { from, until } = histogramWindow();

  const rows = await db.execute<{ key: string | null; day: string; n: string | number }>(raw`
    select ${logEntries.attributes} ->> ${ATTR.SOURCE_ID} as key,
           ${utcDayBucket}                                as day,
           count(*)::int                                  as n
      from ${logEntries}
     where ${logEntries.projectId} IN (
             select ${projects.id} from ${projects}
              where ${projects.workspaceId} = ${workspaceId}
           )
       and ${logEntries.time} >= ${from}
       and ${logEntries.time} <  ${until}
       and ${logEntries.attributes} ->> ${ATTR.SOURCE_ID} is not null
     group by 1, 2
  `);

  return foldDaily(rows.rows, from, out);
}

/**
 * One slice of usage: a dimension value, a day, and how many entries landed.
 *
 * `key` is null for the entries that carry no value for that dimension -- an
 * unclassified severity, or an entry written before the edge stamped a source
 * id. Null rather than a bucket named "none", because the caller decides how to
 * label an absence and the two are different answers.
 */
export interface UsageSlice {
  key: string | null;
  day: Date;
  entries: number;
}

export interface WorkspaceUsage {
  byProject: UsageSlice[];
  bySource: UsageSlice[];
  bySeverity: UsageSlice[];
}

/**
 * What a workspace has ingested, broken down three ways, in ONE pass.
 *
 * Usage is entries. Not bytes, not "events" of some special kind: one row in
 * `log_entries` is one unit, whatever it happens to be called and whatever
 * severity it carries, because that is the whole point of one table (rule 1).
 *
 * `GROUPING SETS` rather than three statements, because all three answers come
 * off the same rows. Three separate `group by`s would read the window three
 * times to say three things about it; one grouping set reads it once and emits
 * the three roll-ups together. `grouping()` is what tells them apart on the way
 * back: it returns 0 for a column that IS in the row's own set, which is the
 * only way to distinguish "this set does not group by severity" from "this
 * entry's severity is null".
 *
 * Every set carries the day as well, so a caller gets both the total for a
 * dimension value (sum its days) and the shape of it over time from one result.
 * A dimension without days would be a fourth set for a number that is already
 * there.
 *
 * The dimensions are named ONCE, in a subquery, and grouped by name outside it.
 * That is not tidiness: `grouping()` and the grouping set have to reference the
 * SAME expression, and drizzle binds every `${...}` as a fresh placeholder, so
 * writing `attributes ->> 'firstrun.source.id'` in both places produced
 * `attributes ->> $3` and `attributes ->> $7` -- two different expressions to
 * Postgres, and the error `arguments to GROUPING must be grouping expressions
 * of the associated query level`. Naming them in a subquery keeps the key bound
 * as a parameter (rule 3: an attribute key is data and never reaches SQL as
 * text) while giving both references one plain column to point at.
 *
 * Bucketed on `time` and in UTC, for the reasons on `projectDailyCounts`.
 *
 * `projectIds`, when given, narrows to those projects. It is the same page at
 * project scope rather than a different one, which is what makes the scope
 * switcher able to stay where it is.
 */
export async function workspaceUsage(
  db: Database,
  workspaceId: string,
  from: Date,
  to: Date,
  projectIds: readonly string[] = []
): Promise<WorkspaceUsage> {
  const scope =
    projectIds.length > 0
      ? raw`${logEntries.projectId} in (${raw.join(
          projectIds.map((id) => raw`${id}`),
          raw`, `
        )})`
      : raw`${logEntries.projectId} IN (
             select ${projects.id} from ${projects}
              where ${projects.workspaceId} = ${workspaceId}
           )`;

  const rows = await db.execute<{
    g_project: number;
    g_source: number;
    project_id: string | null;
    source_id: string | null;
    severity: number | string | null;
    day: string;
    n: string | number;
  }>(raw`
    select grouping(e.project_id) as g_project,
           grouping(e.source_id)  as g_source,
           e.project_id           as project_id,
           e.source_id            as source_id,
           e.severity             as severity,
           e.day                  as day,
           count(*)::int          as n
      from (
        select ${logEntries.projectId}                          as project_id,
               ${logEntries.attributes} ->> ${ATTR.SOURCE_ID}   as source_id,
               ${logEntries.severity}                           as severity,
               ${utcDayBucket}                                  as day
          from ${logEntries}
         where ${scope}
           and ${logEntries.time} >= ${from}
           and ${logEntries.time} <  ${to}
      ) e
     group by grouping sets (
       (e.project_id, e.day),
       (e.source_id, e.day),
       (e.severity, e.day)
     )
  `);

  const out: WorkspaceUsage = { byProject: [], bySource: [], bySeverity: [] };
  for (const row of rows.rows) {
    // `date_trunc` is an expression, so it arrives however `pg` parsed it
    // rather than through the column's decoder -- as everywhere else here.
    const slice = { day: new Date(row.day), entries: Number(row.n ?? 0) };
    if (Number(row.g_project) === 0) {
      out.byProject.push({ ...slice, key: row.project_id });
    } else if (Number(row.g_source) === 0) {
      out.bySource.push({ ...slice, key: row.source_id });
    } else {
      out.bySeverity.push({
        ...slice,
        key: row.severity === null ? null : String(Number(row.severity)),
      });
    }
  }
  return out;
}

/**
 * Entries per project over a window, flat.
 *
 * The baseline behind every delta on the usage page. A plain group-by rather
 * than the grouping set above, because a comparison window is only ever asked
 * for one number per project and reading it three ways would triple the cost of
 * a percentage.
 */
export async function projectEntryCounts(
  db: Database,
  workspaceId: string,
  from: Date,
  to: Date,
  projectIds: readonly string[] = []
): Promise<Map<string, number>> {
  const scope =
    projectIds.length > 0
      ? raw`${logEntries.projectId} in (${raw.join(
          projectIds.map((id) => raw`${id}`),
          raw`, `
        )})`
      : raw`${logEntries.projectId} IN (
             select ${projects.id} from ${projects}
              where ${projects.workspaceId} = ${workspaceId}
           )`;

  const rows = await db.execute<{ project_id: string; n: string | number }>(raw`
    select ${logEntries.projectId} as project_id,
           count(*)::int           as n
      from ${logEntries}
     where ${scope}
       and ${logEntries.time} >= ${from}
       and ${logEntries.time} <  ${to}
     group by 1
  `);

  const out = new Map<string, number>();
  for (const row of rows.rows) out.set(row.project_id, Number(row.n ?? 0));
  return out;
}

export async function listProjects(db: Database, workspaceId: string): Promise<ProjectMeta[]> {
  return db
    .select(projectColumns)
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(projects.createdAt);
}

/**
 * How many projects a workspace has, without listing them.
 *
 * Its own query because the one caller is the plan check on the way IN to
 * creating one: `listProjects` would fetch every column of every row to take
 * `.length` of it, and that is the sort of thing that is fine until somebody
 * has forty projects and a slow link.
 */
export async function countProjects(db: Database, workspaceId: string): Promise<number> {
  const rows = await db
    .select({ n: raw<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId));
  return Number(rows[0]?.n ?? 0);
}

export async function projectForUser(
  db: Database,
  workspaceSlug: string,
  projectSlug: string,
  userId: string
): Promise<ProjectWithRole | null> {
  const rows = await db
    .select({ project: projectColumns, workspace: workspaces, role: workspaceMembers.role })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId))
    )
    .where(and(eq(workspaces.slug, workspaceSlug), eq(projects.slug, projectSlug)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    ...row.project,
    role: row.role,
    workspaceSlug: row.workspace.slug,
    workspaceName: row.workspace.name,
    workspaceLogoUpdatedAt: row.workspace.logoUpdatedAt,
  };
}

/**
 * A project is a name and nothing else.
 *
 * It is created EMPTY: no source, and no board. It used to arrive with an
 * "Overview" board built from a template, which read as helpful and was not:
 * the board answered questions about data that did not exist yet, in a project
 * that had nothing reporting into it, and the first thing anybody did with it
 * was work out whether it was theirs to delete. A board somebody chose beats a
 * board somebody inherited.
 *
 * What replaces it is the quickstart on the project's own page: it lists the
 * steps actually outstanding -- add a source, install it, make a board -- and
 * links to the page that does each one in full. Nothing is generated on
 * somebody's behalf, so nothing has to be undone.
 */
export async function createProject(
  db: Database,
  workspaceId: string,
  name: string
): Promise<Project> {
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(async (candidate) => {
      const hit = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.workspaceId, workspaceId), eq(projects.slug, candidate)))
        .limit(1);
      return hit.length > 0;
    }, name);

    return (await tx.insert(projects).values({ workspaceId, name, slug }).returning())[0]!;
  });
}

/** Re-slugs within the workspace, and returns the slug to redirect to. */
export async function renameProject(
  db: Database,
  workspaceId: string,
  projectId: string,
  name: string
): Promise<string> {
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(async (candidate) => {
      const hit = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, workspaceId),
            eq(projects.slug, candidate),
            ne(projects.id, projectId)
          )
        )
        .limit(1);
      return hit.length > 0;
    }, name);
    await tx
      .update(projects)
      .set({ name, slug })
      .where(and(eq(projects.workspaceId, workspaceId), eq(projects.id, projectId)));
    return slug;
  });
}

/**
 * Removes a project, its sources and dashboards, and every log entry under it.
 *
 * The entries are deleted explicitly for the reason given on `deleteWorkspace`:
 * `log_entries` has no foreign key to `projects`, so nothing cascades into it.
 */
export async function deleteProject(db: Database, projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(logEntries).where(eq(logEntries.projectId, projectId));
    await tx.delete(projects).where(eq(projects.id, projectId));
  });
}

/** How many distinct values a filter picker will offer before it stops being a menu. */
const FACET_LIMIT = 50;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far back a facet reads.
 *
 * A distinct scan with no time predicate reads every partition that has ever
 * existed, and this is a picker: the app version somebody shipped fourteen
 * months ago is not a filter anybody is about to apply. Ninety days prunes to
 * four partitions and keeps the list current, which is also what makes it
 * useful rather than merely complete.
 */
const FACET_DAYS = 90;

export interface ProjectFacets {
  os: string[];
  channel: string[];
  appVersion: string[];
}

/**
 * The values the permanent-filter pickers offer.
 *
 * Read from the project's own entries rather than typed in: a filter for an OS
 * string nobody has ever sent is a filter that silently empties the board. The
 * cap is there because a picker with four thousand app versions in it is not a
 * picker -- if a project has that many, the list stops being useful long before
 * it stops being complete.
 *
 * These three are ATTRIBUTES now rather than columns, so this is a distinct
 * scan over `attributes ->> key` and not over a btree. That is the trade rule 3
 * makes, and it is paid here rather than on a board: a picker opens once, where
 * a widget re-reads on every range change. Whichever of the three turns out to
 * be hot enough to matter is a generated column and an index away, with nothing
 * above this function needing to know.
 */
export async function projectFacets(db: Database, projectId: string): Promise<ProjectFacets> {
  const since = new Date(Date.now() - FACET_DAYS * DAY_MS);

  // The key binds as a parameter like every other value: drizzle's `sql`
  // template interpolates values as placeholders, never as text.
  const distinct = async (key: string): Promise<string[]> => {
    const rows = await db.execute<{ value: string | null }>(raw`
      select distinct ${logEntries.attributes} ->> ${key} as value
        from ${logEntries}
       where ${logEntries.projectId} = ${projectId}
         and ${logEntries.time} >= ${since}
         and ${logEntries.attributes} ->> ${key} is not null
       order by value
       limit ${FACET_LIMIT}
    `);
    return rows.rows
      .map((r) => r.value)
      .filter((v): v is string => typeof v === "string" && v !== "");
  };

  const [os, channel, appVersion] = await Promise.all([
    distinct(ATTR.OS_TYPE),
    distinct(ATTR.CHANNEL),
    distinct(ATTR.SERVICE_VERSION),
  ]);
  return { os, channel, appVersion };
}

/**
 * When each source last sent anything.
 *
 * On `time`, not `ingested_at`: a desktop app replaying a week-old queue was
 * last *heard from* now but last *active* then, and the sources list answers the
 * second question. See CLAUDE.md rule 5.
 *
 * The source id is an attribute the edge stamps, so this groups on JSON rather
 * than on a column. Bounded by the same ninety days as the facets and for the
 * same reason: a source silent for three months reads as "no activity" either
 * way, and the unbounded form reads every partition to say so.
 */
export async function sourceLastSeen(
  db: Database,
  projectId: string
): Promise<Map<string, Date>> {
  return lastSeenIn(db, raw`${logEntries.projectId} = ${projectId}`);
}

/**
 * The same answer for every source in a workspace, in one statement.
 *
 * The workspace-wide sources list would otherwise ask this once per project,
 * which is a round trip per project to fill one column of one page.
 */
export async function workspaceSourceLastSeen(
  db: Database,
  workspaceId: string
): Promise<Map<string, Date>> {
  return lastSeenIn(
    db,
    raw`${logEntries.projectId} IN (
          select ${projects.id} from ${projects}
           where ${projects.workspaceId} = ${workspaceId}
        )`
  );
}

/** The shared body: the scope is the only thing the two callers disagree on. */
async function lastSeenIn(db: Database, scope: SQL): Promise<Map<string, Date>> {
  const since = new Date(Date.now() - FACET_DAYS * DAY_MS);

  const rows = await db.execute<{ source_id: string | null; last_seen: string | null }>(raw`
    select ${logEntries.attributes} ->> ${ATTR.SOURCE_ID} as source_id,
           max(${logEntries.time})                        as last_seen
      from ${logEntries}
     where ${scope}
       and ${logEntries.time} >= ${since}
       and ${logEntries.attributes} ->> ${ATTR.SOURCE_ID} is not null
     group by 1
  `);

  const out = new Map<string, Date>();
  for (const r of rows.rows) {
    // `max(time)` is an expression rather than a column, so drizzle hands back
    // whatever `pg` parsed it as rather than applying the column's decoder.
    if (r.source_id && r.last_seen) out.set(r.source_id, new Date(r.last_seen));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export interface WorkspaceSource extends Source {
  projectName: string;
  projectSlug: string;
}

/**
 * Every source in a workspace, with the project each belongs to.
 *
 * The documentation needs this: its install pages are written against one specific
 * source, and the picker that chooses it spans the whole workspace rather than
 * one project. Fetching it project by project would mean one round trip per
 * project to fill a dropdown.
 *
 * Ordered by project then source so the picker groups without sorting again.
 */
export async function listWorkspaceSources(
  db: Database,
  workspaceId: string
): Promise<WorkspaceSource[]> {
  const rows = await db
    .select({ source: sources, projectName: projects.name, projectSlug: projects.slug })
    .from(sources)
    .innerJoin(projects, eq(sources.projectId, projects.id))
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(projects.name, sources.createdAt);

  return rows.map((r) => ({
    ...r.source,
    projectName: r.projectName,
    projectSlug: r.projectSlug,
  }));
}

export async function listSources(db: Database, projectId: string): Promise<Source[]> {
  return db
    .select()
    .from(sources)
    .where(eq(sources.projectId, projectId))
    .orderBy(sources.createdAt);
}

/**
 * A source is a name and a key. There is nothing else to choose.
 *
 * It used to take a `kind` as well, which decided the middle segment of the key
 * and the value stamped onto every event that arrived through it. Both are gone:
 * see the note on `sources` in schema.ts.
 */
export async function createSource(
  db: Database,
  projectId: string,
  name: string
): Promise<Source> {
  const rows = await db
    .insert(sources)
    .values({ projectId, name, ingestKey: mintSourceKey() })
    .returning();
  return rows[0]!;
}

export async function deleteSource(
  db: Database,
  projectId: string,
  sourceId: string
): Promise<void> {
  await db.delete(sources).where(and(eq(sources.projectId, projectId), eq(sources.id, sourceId)));
}

/** What the edge calls on every request that carries a key. */
export async function sourceByKey(db: Database, ingestKey: string): Promise<Source | null> {
  const rows = await db.select().from(sources).where(eq(sources.ingestKey, ingestKey)).limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export interface DashboardRecord {
  id: string;
  name: string;
  /** How the board is addressed in a URL, unique within the project. */
  slug: string;
  /** Tab order. */
  position: number;
  layout: Board;
}

/**
 * `parseBoard` rather than a bare parse, because it never throws. A dashboard
 * that will not render because one stored widget lost an argument is a worse
 * outcome than one that quietly starts over, and one unreadable card is dropped
 * on its own rather than taking the arrangement with it.
 */
const toRecord = (row: Dashboard): DashboardRecord => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  position: row.position,
  layout: parseBoard(row.layout),
});

/**
 * Copy a board, layout and all, onto the end of the strip.
 *
 * Done in one statement rather than create-then-save from the client: that
 * round trip reads the source board, creates an empty one, then writes the
 * layout into it, and a failure between the second and third steps leaves a
 * blank board named "Overview copy" that nobody asked for.
 */
export async function duplicateDashboard(
  db: Database,
  projectId: string,
  dashboardId: string
): Promise<DashboardRecord | null> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select()
      .from(dashboards)
      .where(and(eq(dashboards.projectId, projectId), eq(dashboards.id, dashboardId)))
      .limit(1);
    if (!source) return null;

    const name = `${source.name} copy`.slice(0, 60);
    const slug = await uniqueSlug(async (candidate) => {
      const hit = await tx
        .select({ id: dashboards.id })
        .from(dashboards)
        .where(and(eq(dashboards.projectId, projectId), eq(dashboards.slug, candidate)))
        .limit(1);
      return hit.length > 0;
    }, name);

    const [tail] = await tx
      .select({ next: raw<number>`coalesce(max(${dashboards.position}) + 1, 0)` })
      .from(dashboards)
      .where(eq(dashboards.projectId, projectId));

    const created = (
      await tx
        .insert(dashboards)
        .values({ projectId, name, slug, position: tail?.next ?? 0, layout: source.layout })
        .returning()
    )[0]!;
    return toRecord(created);
  });
}

/** The tab strip, in the order it is drawn. */
export async function listDashboards(
  db: Database,
  projectId: string
): Promise<DashboardRecord[]> {
  const rows = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.projectId, projectId))
    .orderBy(dashboards.position, dashboards.createdAt);
  return rows.map(toRecord);
}

export async function dashboardBySlug(
  db: Database,
  projectId: string,
  slug: string
): Promise<DashboardRecord | null> {
  const rows = await db
    .select()
    .from(dashboards)
    .where(and(eq(dashboards.projectId, projectId), eq(dashboards.slug, slug)))
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

/** Scoped by project on purpose: an id from another project must not resolve. */
export async function dashboardById(
  db: Database,
  projectId: string,
  dashboardId: string
): Promise<DashboardRecord | null> {
  const rows = await db
    .select()
    .from(dashboards)
    .where(and(eq(dashboards.projectId, projectId), eq(dashboards.id, dashboardId)))
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * The project's first board, or null.
 *
 * Null is a real answer now: a project is created empty and stays that way
 * until somebody makes a board. This used to CREATE one when it found none,
 * which is how a project that was deliberately empty grew an "Overview" nobody
 * asked for the first time any page called this.
 */
export async function defaultDashboard(
  db: Database,
  projectId: string
): Promise<DashboardRecord | null> {
  const rows = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.projectId, projectId))
    .orderBy(dashboards.position, dashboards.createdAt)
    .limit(1);

  const existing = rows[0];
  return existing ? toRecord(existing) : null;
}

/** Kept because "the project's board" is still what most callers mean. */
export const dashboardFor = defaultDashboard;

export async function createDashboard(
  db: Database,
  projectId: string,
  name: string,
  layout: Board = defaultBoard()
): Promise<DashboardRecord> {
  return db.transaction(async (tx) => {
    const slug = await uniqueSlug(async (candidate) => {
      const hit = await tx
        .select({ id: dashboards.id })
        .from(dashboards)
        .where(and(eq(dashboards.projectId, projectId), eq(dashboards.slug, candidate)))
        .limit(1);
      return hit.length > 0;
    }, name);

    // New boards go on the end of the strip, never in front of what is there.
    const [tail] = await tx
      .select({ next: raw<number>`coalesce(max(${dashboards.position}) + 1, 0)` })
      .from(dashboards)
      .where(eq(dashboards.projectId, projectId));

    const created = (
      await tx
        .insert(dashboards)
        .values({ projectId, name, slug, position: tail?.next ?? 0, layout })
        .returning()
    )[0]!;
    return toRecord(created);
  });
}

/**
 * Renaming re-slugs, which moves the board's URL.
 *
 * Same trade as a workspace: a slug that no longer resembles the name is a
 * worse surprise than a stale link, and the tab strip is regenerated on the
 * next load anyway.
 */
export async function renameDashboard(
  db: Database,
  dashboardId: string,
  name: string
): Promise<DashboardRecord> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(dashboards)
      .where(eq(dashboards.id, dashboardId))
      .limit(1);
    const existing = rows[0];
    if (!existing) throw new Error("No such dashboard.");

    const slug = await uniqueSlug(async (candidate) => {
      const hit = await tx
        .select({ id: dashboards.id })
        .from(dashboards)
        .where(
          and(
            eq(dashboards.projectId, existing.projectId),
            eq(dashboards.slug, candidate),
            // Excluding itself, or renaming a board to what it is already
            // called would suffix its own slug every time.
            ne(dashboards.id, dashboardId)
          )
        )
        .limit(1);
      return hit.length > 0;
    }, name);

    const updated = (
      await tx
        .update(dashboards)
        .set({ name, slug, updatedAt: new Date() })
        .where(eq(dashboards.id, dashboardId))
        .returning()
    )[0]!;
    return toRecord(updated);
  });
}

/**
 * The last board on a project cannot be deleted.
 *
 * Same shape as `isLastAdmin`, and for the same reason: a project with no
 * dashboard is a project whose only screen does not exist, and the UI offers no
 * way back from there.
 */
export async function deleteDashboard(
  db: Database,
  projectId: string,
  dashboardId: string
): Promise<{ ok: true } | { error: string }> {
  const all = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(eq(dashboards.projectId, projectId));

  // No floor. A project with no boards is a legal, reachable state -- it is
  // what every new project is -- so the last board is deletable like any other,
  // and the quickstart offers to make another.
  if (!all.some((d) => d.id === dashboardId)) return { error: "No such dashboard." };

  await db
    .delete(dashboards)
    .where(and(eq(dashboards.projectId, projectId), eq(dashboards.id, dashboardId)));
  return { ok: true };
}

/**
 * Positions are rewritten from the order of `ids`.
 *
 * Every update is scoped by project as well as by id, so an id from somewhere
 * else moves nothing rather than reordering a board the caller cannot see.
 */
export async function reorderDashboards(
  db: Database,
  projectId: string,
  ids: string[]
): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [position, id] of ids.entries()) {
      await tx
        .update(dashboards)
        .set({ position })
        .where(and(eq(dashboards.projectId, projectId), eq(dashboards.id, id)));
    }
  });
}

/** Keyed on the dashboard, not the project: a project has several of them. */
export async function saveLayout(
  db: Database,
  dashboardId: string,
  layout: Board
): Promise<void> {
  await db
    .update(dashboards)
    .set({ layout, updatedAt: new Date() })
    .where(eq(dashboards.id, dashboardId));
}

/**
 * Used by the seed and by tests to start from a known state.
 *
 * One statement, because there is exactly one table an entry ever touched.
 * There used to be five.
 *
 * A DELETE rather than a partition drop, which does not contradict the
 * retention rule: this removes ONE project from partitions other projects are
 * still writing to. Retention removes a whole month from everybody, and that is
 * the case `dropExpiredPartitions` exists for.
 */
export async function clearProjectData(db: Database, projectId: string): Promise<void> {
  await db.delete(logEntries).where(eq(logEntries.projectId, projectId));
}
