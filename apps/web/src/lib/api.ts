import { createServerFn } from "@tanstack/solid-start";
import { DashboardLayout } from "@firstrun/schema";
import type { Snapshot } from "@firstrun/db";
import type { DashboardLayout as Layout } from "@firstrun/schema";

/**
 * Everything the UI asks the server for.
 *
 * Each handler pulls its implementation in with a dynamic import so the
 * server-only modules -- the pool, the session cookie, the SQL -- never enter
 * the client graph. Start strips handler bodies from the browser bundle, but a
 * top-level import of a `.server` module would still be traced.
 *
 * Every mutation re-checks the caller's role on the server. The UI hides what a
 * reader cannot do, but hiding a button is a courtesy, not a permission check.
 */

export type MemberRole = "admin" | "read";

export interface SessionUser {
  id: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: MemberRole;
}

export interface SessionInfo {
  user: SessionUser | null;
  workspaces: WorkspaceSummary[];
  /** False when GitHub OAuth is not configured, so /login can say so. */
  loginConfigured: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  slug: string;
}

export interface MemberSummary {
  userId: string;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  role: MemberRole;
}

export interface WorkspaceView {
  workspace: WorkspaceSummary;
  projects: ProjectSummary[];
  members: MemberSummary[];
  currentUserId: string;
}

export interface SourceSummary {
  id: string;
  name: string;
  kind: "web" | "desktop";
  assetName: string | null;
  ingestKey: string;
}

export interface ProjectView {
  workspace: WorkspaceSummary;
  project: ProjectSummary;
  role: MemberRole;
  sources: SourceSummary[];
  layout: Layout;
  snapshot: Snapshot;
  /** Absolute origin the tag and SDK should talk to. */
  publicOrigin: string;
}

export type Result<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; error: string };

export const getSession = createServerFn({ method: "GET" }).handler(async (): Promise<SessionInfo> => {
  const { loadSession } = await import("./api.server.js");
  return loadSession();
});

export const getWorkspace = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(async ({ data }): Promise<WorkspaceView | null> => {
    const { loadWorkspace } = await import("./api.server.js");
    return loadWorkspace(data);
  });

export const getProject = createServerFn({ method: "GET" })
  .validator((input: { workspace: string; project: string }) => input)
  .handler(async ({ data }): Promise<ProjectView | null> => {
    const { loadProject } = await import("./api.server.js");
    return loadProject(data.workspace, data.project);
  });

export const saveDashboard = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; project: string; layout: unknown }) => ({
    workspace: input.workspace,
    project: input.project,
    // Parsed here rather than trusted: this is a POST body, and the catalogue
    // is the whole difference between an arrangeable dashboard and an
    // arbitrary one.
    layout: DashboardLayout.parse(input.layout),
  }))
  .handler(async ({ data }): Promise<Result> => {
    const { persistDashboard } = await import("./api.server.js");
    return persistDashboard(data.workspace, data.project, data.layout);
  });

export const createWorkspaceFn = createServerFn({ method: "POST" })
  .validator((name: string) => name.trim().slice(0, 60))
  .handler(async ({ data }): Promise<Result<{ slug: string }>> => {
    const { addWorkspace } = await import("./api.server.js");
    return addWorkspace(data);
  });

export const createProjectFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; name: string }) => input)
  .handler(async ({ data }): Promise<Result<{ slug: string }>> => {
    const { addProject } = await import("./api.server.js");
    return addProject(data.workspace, data.name);
  });

export const createSourceFn = createServerFn({ method: "POST" })
  .validator(
    (input: {
      workspace: string;
      project: string;
      name: string;
      kind: "web" | "desktop";
      assetName?: string;
    }) => input
  )
  .handler(async ({ data }): Promise<Result> => {
    const { addSource } = await import("./api.server.js");
    return addSource(data);
  });

export const deleteSourceFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; project: string; sourceId: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { removeSource } = await import("./api.server.js");
    return removeSource(data.workspace, data.project, data.sourceId);
  });

export const addMemberFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; login: string; role: MemberRole }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { inviteMember } = await import("./api.server.js");
    return inviteMember(data.workspace, data.login, data.role);
  });

export const setMemberRoleFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; userId: string; role: MemberRole }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { changeMemberRole } = await import("./api.server.js");
    return changeMemberRole(data.workspace, data.userId, data.role);
  });

export const removeMemberFn = createServerFn({ method: "POST" })
  .validator((input: { workspace: string; userId: string }) => input)
  .handler(async ({ data }): Promise<Result> => {
    const { kickMember } = await import("./api.server.js");
    return kickMember(data.workspace, data.userId);
  });
