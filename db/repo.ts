import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, isNull, lt, lte, sql as raw } from "drizzle-orm";
import { DashboardLayout, defaultLayout, mintSourceKey } from "@firstrun/schema";
import type { Database } from "./client.js";
import {
  dashboards,
  downloadHints,
  downloadTokens,
  events,
  sessions,
  sources,
  users,
  workspaceMembers,
  workspaces,
  type Source,
  type User,
  type Workspace,
} from "./schema.js";

/**
 * Everything that is not an analytics query.
 *
 * Grouped by the thing it is about rather than by table, so a caller asks for
 * "the workspaces this user can see" instead of assembling a join. Drizzle
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
// Workspaces
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

export interface WorkspaceWithRole extends Workspace {
  role: "owner" | "member";
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
 * Membership is checked here, not by the caller.
 *
 * Every route that loads a workspace goes through this, so "can this person see
 * this workspace" has exactly one answer in exactly one place. A route that
 * forgets gets `null` and renders a not-found, which is the safe direction.
 */
export async function workspaceForUser(
  db: Database,
  slugOrId: string,
  userId: string
): Promise<WorkspaceWithRole | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slugOrId);
  const rows = await db
    .select({ workspace: workspaces, role: workspaceMembers.role })
    .from(workspaces)
    .innerJoin(
      workspaceMembers,
      and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId))
    )
    .where(isUuid ? eq(workspaces.id, slugOrId) : eq(workspaces.slug, slugOrId))
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
    // Slug collisions are resolved by suffixing rather than rejected: the name
    // is the user's, the slug is ours, and refusing "Themia" because someone
    // else already took it would be our problem leaking into their form.
    const base = slugify(name);
    let slug = base;
    for (let n = 2; ; n++) {
      const taken = await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, slug)).limit(1);
      if (taken.length === 0) break;
      slug = `${base}-${n}`;
    }

    const created = (await tx.insert(workspaces).values({ name, slug }).returning())[0]!;
    await tx.insert(workspaceMembers).values({
      workspaceId: created.id,
      userId: ownerId,
      role: "owner",
    });
    await tx.insert(dashboards).values({
      workspaceId: created.id,
      name: "Overview",
      layout: defaultLayout(),
    });
    return created;
  });
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function listSources(db: Database, workspaceId: string): Promise<Source[]> {
  return db
    .select()
    .from(sources)
    .where(eq(sources.workspaceId, workspaceId))
    .orderBy(sources.createdAt);
}

export async function createSource(
  db: Database,
  workspaceId: string,
  name: string,
  kind: "web" | "desktop",
  assetName: string | null
): Promise<Source> {
  const rows = await db
    .insert(sources)
    .values({ workspaceId, name, kind, assetName, ingestKey: mintSourceKey(kind) })
    .returning();
  return rows[0]!;
}

export async function deleteSource(db: Database, workspaceId: string, sourceId: string): Promise<void> {
  await db.delete(sources).where(and(eq(sources.workspaceId, workspaceId), eq(sources.id, sourceId)));
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
 * A workspace always has a dashboard.
 *
 * Created lazily rather than failing, so a workspace made before the default
 * layout changed, or made by the seed, still opens.
 */
export async function dashboardFor(db: Database, workspaceId: string): Promise<DashboardRecord> {
  const rows = await db
    .select()
    .from(dashboards)
    .where(eq(dashboards.workspaceId, workspaceId))
    .orderBy(dashboards.createdAt)
    .limit(1);

  const existing = rows[0];
  if (existing) {
    const parsed = DashboardLayout.safeParse(existing.layout);
    return {
      id: existing.id,
      name: existing.name,
      // A layout written by an older version of the catalogue should degrade to
      // the default, not crash the only screen in the product.
      layout: parsed.success ? parsed.data : defaultLayout(),
    };
  }

  const created = (
    await db.insert(dashboards).values({ workspaceId, name: "Overview", layout: defaultLayout() }).returning()
  )[0]!;
  return { id: created.id, name: created.name, layout: defaultLayout() };
}

export async function saveLayout(
  db: Database,
  workspaceId: string,
  layout: DashboardLayout
): Promise<void> {
  await db
    .update(dashboards)
    .set({ layout, updatedAt: new Date() })
    .where(eq(dashboards.workspaceId, workspaceId));
}

// ---------------------------------------------------------------------------
// Download tokens and hints
// ---------------------------------------------------------------------------

export interface NewToken {
  token: string;
  workspaceId: string;
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
  hint: { workspaceId: string; webVisitorId: string; ipHash: string; os: string | null }
): Promise<void> {
  await db.insert(downloadHints).values(hint);
}

export async function candidateHints(
  db: Database,
  workspaceId: string,
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
        eq(downloadHints.workspaceId, workspaceId),
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
export async function clearWorkspaceData(db: Database, workspaceId: string): Promise<void> {
  await db.delete(events).where(eq(events.workspaceId, workspaceId));
  await db.execute(raw`DELETE FROM identity_edges WHERE workspace_id = ${workspaceId}::uuid`);
  await db.execute(raw`DELETE FROM person_overrides WHERE workspace_id = ${workspaceId}::uuid`);
  await db.delete(downloadTokens).where(eq(downloadTokens.workspaceId, workspaceId));
  await db.delete(downloadHints).where(eq(downloadHints.workspaceId, workspaceId));
}
