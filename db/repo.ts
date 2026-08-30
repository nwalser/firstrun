import { createHash, randomBytes } from "node:crypto";
import { and, eq, gte, lt, ne, sql as raw } from "drizzle-orm";
import { defaultBoard, mintSourceKey, parseBoard, type Board } from "@firstrun/schema";
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
  type SourceKind,
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

export interface ProjectWithRole extends Project {
  /** The role the current user holds in the owning workspace. */
  role: MemberRole;
  workspaceSlug: string;
  workspaceName: string;
  workspaceLogoUpdatedAt: Date | null;
}

export interface ProjectStats extends Project {
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
      project: projects,
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

export async function listProjects(db: Database, workspaceId: string): Promise<Project[]> {
  return db
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(projects.createdAt);
}

export async function projectForUser(
  db: Database,
  workspaceSlug: string,
  projectSlug: string,
  userId: string
): Promise<ProjectWithRole | null> {
  const rows = await db
    .select({ project: projects, workspace: workspaces, role: workspaceMembers.role })
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
 * A project is created with a board, never without one.
 *
 * `layout` is a template the person picked at creation time, defaulting to the
 * overview -- an empty canvas asks a question somebody who has just installed
 * the tag cannot yet answer.
 */
export async function createProject(
  db: Database,
  workspaceId: string,
  name: string,
  layout: Board = defaultBoard()
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

    const created = (await tx.insert(projects).values({ workspaceId, name, slug }).returning())[0]!;
    await tx.insert(dashboards).values({
      projectId: created.id,
      name: "Overview",
      slug: "overview",
      position: 0,
      layout,
    });
    return created;
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
  const since = new Date(Date.now() - FACET_DAYS * DAY_MS);

  const rows = await db.execute<{ source_id: string | null; last_seen: string | null }>(raw`
    select ${logEntries.attributes} ->> ${ATTR.SOURCE_ID} as source_id,
           max(${logEntries.time})                        as last_seen
      from ${logEntries}
     where ${logEntries.projectId} = ${projectId}
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
 * The wiki needs this: its install pages are written against one specific
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
 * `kind` is the surface every event from this source will be stamped with, so
 * it is chosen once, here. A client sends a key and never claims a surface.
 */
export async function createSource(
  db: Database,
  projectId: string,
  name: string,
  kind: SourceKind,
  assetName: string | null
): Promise<Source> {
  const rows = await db
    .insert(sources)
    .values({ projectId, name, kind, assetName, ingestKey: mintSourceKey(kind) })
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
 * `parseBoard` rather than a bare parse: it migrates a board written before the
 * query layer on the way through, and never throws. A dashboard that will not
 * render because one stored widget lost an argument is a worse outcome than one
 * that quietly starts over, and one unreadable card is dropped on its own
 * rather than taking the arrangement with it.
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
 * A project always has at least one dashboard.
 *
 * Created lazily rather than failing, so a project made before the default
 * layout changed, or made by the seed, still opens.
 */
export async function defaultDashboard(
  db: Database,
  projectId: string
): Promise<DashboardRecord> {
  const rows = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.projectId, projectId))
    .orderBy(dashboards.position, dashboards.createdAt)
    .limit(1);

  const existing = rows[0];
  if (existing) return toRecord(existing);
  return createDashboard(db, projectId, "Overview", defaultBoard());
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

  if (!all.some((d) => d.id === dashboardId)) return { error: "No such dashboard." };
  if (all.length <= 1) return { error: "A project needs at least one dashboard." };

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
