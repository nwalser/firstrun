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
 * top-level import of a `.server` module would still be traced, and the failure
 * mode is a confusing build error rather than a leak.
 */

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
  role: "owner" | "member";
}

export interface SessionInfo {
  user: SessionUser | null;
  workspaces: WorkspaceSummary[];
  /** False when GitHub OAuth is not configured, so /login can say so. */
  loginConfigured: boolean;
}

export interface SourceSummary {
  id: string;
  name: string;
  kind: "web" | "desktop";
  assetName: string | null;
  ingestKey: string;
}

export interface WorkspaceView {
  workspace: WorkspaceSummary;
  sources: SourceSummary[];
  layout: Layout;
  snapshot: Snapshot;
  /** Absolute origin the tag and SDK should talk to. */
  publicOrigin: string;
}

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

export const saveDashboard = createServerFn({ method: "POST" })
  .validator((input: { slug: string; layout: unknown }) => ({
    slug: input.slug,
    // Parsed here rather than trusted: this is a POST body, and the catalogue
    // is the whole difference between an arrangeable dashboard and an
    // arbitrary one.
    layout: DashboardLayout.parse(input.layout),
  }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { persistDashboard } = await import("./api.server.js");
    return persistDashboard(data.slug, data.layout);
  });

export const createWorkspaceFn = createServerFn({ method: "POST" })
  .validator((name: string) => name.trim().slice(0, 60))
  .handler(async ({ data }): Promise<{ slug: string } | { error: string }> => {
    const { addWorkspace } = await import("./api.server.js");
    return addWorkspace(data);
  });

export const createSourceFn = createServerFn({ method: "POST" })
  .validator((input: { slug: string; name: string; kind: "web" | "desktop"; assetName?: string }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { addSource } = await import("./api.server.js");
    return addSource(data);
  });

export const deleteSourceFn = createServerFn({ method: "POST" })
  .validator((input: { slug: string; sourceId: string }) => input)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { removeSource } = await import("./api.server.js");
    return removeSource(data.slug, data.sourceId);
  });
