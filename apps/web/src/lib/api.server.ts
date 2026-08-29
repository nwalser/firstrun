import {
  addMemberByLogin,
  createProject,
  createSource,
  createWorkspace,
  dashboardFor,
  deleteSource,
  listMembers,
  listProjects,
  listSources,
  listWorkspaces,
  projectForUser,
  removeMember,
  saveLayout,
  setMemberRole,
  snapshot,
  workspaceForUser,
} from "@firstrun/db";
import { configFromEnv } from "@firstrun/ingest";
import type { DashboardLayout } from "@firstrun/schema";
import { getRequest } from "@tanstack/solid-start/server";
import type { MemberRole, ProjectView, Result, SessionInfo, WorkspaceView } from "./api.js";
import { currentUser, oauthConfig } from "./auth.server.js";
import { ensureReady, getStore } from "./context.server.js";

/**
 * The server side of every UI call.
 *
 * Access is resolved here, once, by `workspaceForUser` and `projectForUser`.
 * Nothing below this file re-checks it and nothing above it may skip it: a
 * route that forgets gets `null` and renders a not-found, which is the safe
 * direction to fail in.
 *
 * `requireAdmin` is separate from `requireAccess` on purpose. Reading and
 * changing are different questions, and answering them with the same call is
 * how a read-only member ends up able to POST.
 */

const denied = (error: string): Result => ({ ok: false, error });

export async function loadSession(): Promise<SessionInfo> {
  await ensureReady();
  const request = getRequest();
  const user = await currentUser(request);
  const loginConfigured = oauthConfig(request) !== null;

  if (!user) return { user: null, workspaces: [], loginConfigured };

  const workspaces = await listWorkspaces(getStore().db, user.id);
  return {
    user: { id: user.id, login: user.login, name: user.name, avatarUrl: user.avatarUrl },
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name, slug: w.slug, role: w.role })),
    loginConfigured,
  };
}

async function requireAccess(workspaceSlug: string) {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return null;
  const workspace = await workspaceForUser(getStore().db, workspaceSlug, user.id);
  if (!workspace) return null;
  return { user, workspace };
}

/** Read access is not enough here. Returns null for a reader, same as for a stranger. */
async function requireAdmin(workspaceSlug: string) {
  const access = await requireAccess(workspaceSlug);
  if (!access || access.workspace.role !== "admin") return null;
  return access;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function loadWorkspace(slug: string): Promise<WorkspaceView | null> {
  const access = await requireAccess(slug);
  if (!access) return null;

  const db = getStore().db;
  const [projects, members] = await Promise.all([
    listProjects(db, access.workspace.id),
    listMembers(db, access.workspace.id),
  ]);

  return {
    workspace: {
      id: access.workspace.id,
      name: access.workspace.name,
      slug: access.workspace.slug,
      role: access.workspace.role,
    },
    projects: projects.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    members,
    currentUserId: access.user.id,
  };
}

export async function loadProject(
  workspaceSlug: string,
  projectSlug: string
): Promise<ProjectView | null> {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return null;

  const store = getStore();
  const project = await projectForUser(store.db, workspaceSlug, projectSlug, user.id);
  if (!project) return null;

  const dashboard = await dashboardFor(store.db, project.id);
  const [sources, snap] = await Promise.all([
    listSources(store.db, project.id),
    snapshot(store, project.id, dashboard.layout),
  ]);

  return {
    workspace: {
      id: project.workspaceId,
      name: project.workspaceName,
      slug: project.workspaceSlug,
      role: project.role,
    },
    project: { id: project.id, name: project.name, slug: project.slug },
    role: project.role,
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      assetName: s.assetName,
      ingestKey: s.ingestKey,
    })),
    layout: dashboard.layout,
    snapshot: snap,
    publicOrigin: configFromEnv().publicOrigin,
  };
}

// ---------------------------------------------------------------------------
// Writes. Every one of these is admin-only.
// ---------------------------------------------------------------------------

export async function persistDashboard(
  workspaceSlug: string,
  projectSlug: string,
  layout: DashboardLayout
): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to change this dashboard.");

  const store = getStore();
  const project = await projectForUser(store.db, workspaceSlug, projectSlug, access.user.id);
  if (!project) return denied("No such project.");

  await saveLayout(store.db, project.id, layout);
  return { ok: true };
}

export async function addWorkspace(name: string): Promise<Result<{ slug: string }>> {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return denied("Not signed in.");
  if (!name) return denied("A workspace needs a name.");
  const created = await createWorkspace(getStore().db, name, user.id);
  return { ok: true, slug: created.slug };
}

export async function addProject(
  workspaceSlug: string,
  name: string
): Promise<Result<{ slug: string }>> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to add a project.");
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return denied("A project needs a name.");
  const created = await createProject(getStore().db, access.workspace.id, trimmed);
  return { ok: true, slug: created.slug };
}

export async function addSource(input: {
  workspace: string;
  project: string;
  name: string;
  kind: "web" | "desktop";
  assetName?: string;
}): Promise<Result> {
  const access = await requireAdmin(input.workspace);
  if (!access) return denied("You need admin access to add a source.");

  const store = getStore();
  const project = await projectForUser(store.db, input.workspace, input.project, access.user.id);
  if (!project) return denied("No such project.");

  await createSource(
    store.db,
    project.id,
    input.name.trim().slice(0, 60) || "Untitled",
    input.kind,
    input.kind === "desktop" ? input.assetName?.trim() || "Setup" : null
  );
  return { ok: true };
}

export async function removeSource(
  workspaceSlug: string,
  projectSlug: string,
  sourceId: string
): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to remove a source.");

  const store = getStore();
  const project = await projectForUser(store.db, workspaceSlug, projectSlug, access.user.id);
  if (!project) return denied("No such project.");

  await deleteSource(store.db, project.id, sourceId);
  return { ok: true };
}

export async function inviteMember(
  workspaceSlug: string,
  login: string,
  role: MemberRole
): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to add people.");

  const trimmed = login.trim().replace(/^@/, "");
  if (!trimmed) return denied("Enter a GitHub username.");

  const result = await addMemberByLogin(getStore().db, access.workspace.id, trimmed, role);
  return "error" in result ? denied(result.error) : { ok: true };
}

export async function changeMemberRole(
  workspaceSlug: string,
  userId: string,
  role: MemberRole
): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to change roles.");
  const result = await setMemberRole(getStore().db, access.workspace.id, userId, role);
  return "error" in result ? denied(result.error) : { ok: true };
}

export async function kickMember(workspaceSlug: string, userId: string): Promise<Result> {
  const access = await requireAdmin(workspaceSlug);
  if (!access) return denied("You need admin access to remove people.");
  const result = await removeMember(getStore().db, access.workspace.id, userId);
  return "error" in result ? denied(result.error) : { ok: true };
}
