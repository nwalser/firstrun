import {
  createSource,
  createWorkspace,
  dashboardFor,
  deleteSource,
  listSources,
  listWorkspaces,
  saveLayout,
  snapshot,
  workspaceForUser,
} from "@firstrun/db";
import { configFromEnv } from "@firstrun/ingest";
import type { DashboardLayout } from "@firstrun/schema";
import { getRequest } from "@tanstack/solid-start/server";
import type { SessionInfo, WorkspaceView } from "./api.js";
import { currentUser, oauthConfig } from "./auth.server.js";
import { ensureReady, getStore } from "./context.server.js";

/**
 * The server side of every UI call.
 *
 * Membership is checked by `workspaceForUser`, once, here. Nothing below this
 * file re-checks it and nothing above it is allowed to skip it: a route that
 * forgets gets `null` and renders a not-found, which is the safe direction to
 * fail in.
 */

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

async function requireMembership(slug: string) {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return null;
  const workspace = await workspaceForUser(getStore().db, slug, user.id);
  if (!workspace) return null;
  return { user, workspace };
}

export async function loadWorkspace(slug: string): Promise<WorkspaceView | null> {
  const access = await requireMembership(slug);
  if (!access) return null;

  const store = getStore();
  const dashboard = await dashboardFor(store.db, access.workspace.id);
  const [sources, snap] = await Promise.all([
    listSources(store.db, access.workspace.id),
    snapshot(store, access.workspace.id, dashboard.layout),
  ]);

  return {
    workspace: {
      id: access.workspace.id,
      name: access.workspace.name,
      slug: access.workspace.slug,
      role: access.workspace.role,
    },
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

export async function persistDashboard(slug: string, layout: DashboardLayout) {
  const access = await requireMembership(slug);
  if (!access) return { ok: false };
  await saveLayout(getStore().db, access.workspace.id, layout);
  return { ok: true };
}

export async function addWorkspace(name: string) {
  await ensureReady();
  const user = await currentUser(getRequest());
  if (!user) return { error: "not signed in" };
  if (!name) return { error: "a workspace needs a name" };
  const created = await createWorkspace(getStore().db, name, user.id);
  return { slug: created.slug };
}

export async function addSource(input: {
  slug: string;
  name: string;
  kind: "web" | "desktop";
  assetName?: string;
}) {
  const access = await requireMembership(input.slug);
  if (!access) return { ok: false };
  await createSource(
    getStore().db,
    access.workspace.id,
    input.name.trim().slice(0, 60) || "Untitled",
    input.kind,
    input.kind === "desktop" ? (input.assetName?.trim() || "Setup") : null
  );
  return { ok: true };
}

export async function removeSource(slug: string, sourceId: string) {
  const access = await requireMembership(slug);
  if (!access) return { ok: false };
  await deleteSource(getStore().db, access.workspace.id, sourceId);
  return { ok: true };
}
