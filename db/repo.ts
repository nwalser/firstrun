import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, isNull, lt, lte, sql as raw } from "drizzle-orm";
import { DashboardLayout, defaultLayout, mintSourceKey } from "@firstrun/schema";
import type { Database } from "./client.js";
import {
  dashboards,
  downloadHints,
  downloadTokens,
  events,
  projects,
  sessions,
  sources,
  users,
  workspaceMembers,
  workspaces,
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
  };
}

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

    const created = (await tx.insert(projects).values({ workspaceId, name, slug }).returning())[0]!;
    await tx.insert(dashboards).values({
      projectId: created.id,
      name: "Overview",
      layout: defaultLayout(),
    });
    return created;
  });
}

export async function deleteProject(db: Database, projectId: string): Promise<void> {
  await db.delete(projects).where(eq(projects.id, projectId));
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function listSources(db: Database, projectId: string): Promise<Source[]> {
  return db
    .select()
    .from(sources)
    .where(eq(sources.projectId, projectId))
    .orderBy(sources.createdAt);
}

export async function createSource(
  db: Database,
  projectId: string,
  name: string,
  kind: "web" | "desktop",
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
  layout: DashboardLayout;
}

/**
 * A project always has a dashboard.
 *
 * Created lazily rather than failing, so a project made before the default
 * layout changed, or made by the seed, still opens.
 */
export async function dashboardFor(db: Database, projectId: string): Promise<DashboardRecord> {
  const rows = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.projectId, projectId))
    .orderBy(dashboards.createdAt)
    .limit(1);

  const existing = rows[0];
  if (existing) {
    const parsed = DashboardLayout.safeParse(existing.layout);
    return {
      id: existing.id,
      name: existing.name,
      // A layout written by an older version of the catalogue degrades to the
      // default rather than crashing the only screen in the product.
      layout: parsed.success ? parsed.data : defaultLayout(),
    };
  }

  const created = (
    await db.insert(dashboards).values({ projectId, name: "Overview", layout: defaultLayout() }).returning()
  )[0]!;
  return { id: created.id, name: created.name, layout: defaultLayout() };
}

export async function saveLayout(
  db: Database,
  projectId: string,
  layout: DashboardLayout
): Promise<void> {
  await db
    .update(dashboards)
    .set({ layout, updatedAt: new Date() })
    .where(eq(dashboards.projectId, projectId));
}

// ---------------------------------------------------------------------------
// Download tokens and hints
// ---------------------------------------------------------------------------

export interface NewToken {
  token: string;
  projectId: string;
  sourceId: string | null;
  webVisitorId: string | null;
  asset: string;
  expiresAt: Date;
}

export async function createDownloadToken(db: Database, t: NewToken): Promise<void> {
  await db.insert(downloadTokens).values(t);
}

export async function downloadToken(db: Database, token: string) {
  const rows = await db.select().from(downloadTokens).where(eq(downloadTokens.token, token)).limit(1);
  return rows[0] ?? null;
}

/**
 * Marks a token claimed, and says whether this call is the one that did it.
 *
 * A first run can fire twice -- the install hook wrote the token file AND the
 * Downloads scan found the installer. The second claim must be a no-op rather
 * than a second edge, so the update is conditional and the caller keys off the
 * row count.
 */
export async function claimDownloadToken(
  db: Database,
  token: string,
  at: Date
): Promise<{ claimed: boolean }> {
  const rows = await db
    .update(downloadTokens)
    .set({ claimedAt: at })
    .where(and(eq(downloadTokens.token, token), isNull(downloadTokens.claimedAt)))
    .returning({ token: downloadTokens.token });
  return { claimed: rows.length > 0 };
}

export async function expireDownloadTokens(db: Database, now: Date): Promise<void> {
  await db.delete(downloadTokens).where(and(lt(downloadTokens.expiresAt, now), isNull(downloadTokens.claimedAt)));
}

export async function recordDownloadHint(
  db: Database,
  hint: { projectId: string; webVisitorId: string; ipHash: string; os: string | null }
): Promise<void> {
  await db.insert(downloadHints).values(hint);
}

export async function candidateHints(
  db: Database,
  projectId: string,
  ipHash: string,
  os: string | null,
  since: Date,
  until: Date
) {
  return db
    .select()
    .from(downloadHints)
    .where(
      and(
        eq(downloadHints.projectId, projectId),
        eq(downloadHints.ipHash, ipHash),
        gte(downloadHints.createdAt, since),
        lte(downloadHints.createdAt, until),
        // A null OS on either side is "we do not know", which should widen the
        // match rather than silently exclude it.
        os ? raw`(${downloadHints.os} IS NULL OR ${downloadHints.os} = ${os})` : undefined
      )
    )
    .orderBy(desc(downloadHints.createdAt));
}

export async function pruneDownloadHints(db: Database, olderThan: Date): Promise<void> {
  await db.delete(downloadHints).where(lt(downloadHints.createdAt, olderThan));
}

/** Used by the seed and by tests to start from a known state. */
export async function clearProjectData(db: Database, projectId: string): Promise<void> {
  await db.delete(events).where(eq(events.projectId, projectId));
  await db.execute(raw`DELETE FROM identity_edges WHERE project_id = ${projectId}::uuid`);
  await db.execute(raw`DELETE FROM person_overrides WHERE project_id = ${projectId}::uuid`);
  await db.delete(downloadTokens).where(eq(downloadTokens.projectId, projectId));
  await db.delete(downloadHints).where(eq(downloadHints.projectId, projectId));
}
