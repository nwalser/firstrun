import type { Distinct, IdentityEdge, PersonOverride } from "./types.js";
import { distinctKey, isExact } from "./types.js";

/**
 * Everything `@firstrun/identity` needs from persistence, and nothing more.
 *
 * Deliberately not a database client: resolution is the hard part and it has to
 * be testable without one. The real implementation lives in
 * `db/identity-store.ts` and satisfies this structurally, so there is no
 * dependency edge from identity to db.
 */
export interface IdentityStore {
  insertEdges(edges: readonly IdentityEdge[]): Promise<void>;

  /**
   * One hop out from `distincts` over EXACT edges only.
   *
   * Estimate edges must never come back from here. That is the single
   * chokepoint enforcing CLAUDE.md rule 1: if an estimate edge cannot enter
   * traversal, it cannot influence a person id.
   */
  exactEdgesTouching(workspaceId: string, distincts: readonly Distinct[]): Promise<IdentityEdge[]>;

  /** distinctKey -> person_id, for distincts that have one. */
  getOverrides(workspaceId: string, distincts: readonly Distinct[]): Promise<Map<string, string>>;

  putOverrides(rows: readonly PersonOverride[]): Promise<void>;

  /** Overrides not yet drained into events.person_id. */
  pendingOverrides(limit?: number): Promise<PersonOverride[]>;

  /** Squash only. Returns rows touched. */
  rewriteEventPersons(
    workspaceId: string,
    personId: string,
    distincts: readonly Distinct[]
  ): Promise<number>;

  deleteOverrides(rows: readonly PersonOverride[]): Promise<void>;
}

/** A stored event, reduced to what squash needs to find and rewrite it. */
export interface EventRow {
  workspace_id: string;
  event_id: string;
  person_id: string;
  web_visitor_id: string | null;
  install_id: string | null;
  account_id: string | null;
}

/**
 * In-memory store. Used by the identity tests and by the ingest end-to-end test,
 * which is why it ships in src rather than test.
 */
export class MemoryIdentityStore implements IdentityStore {
  readonly edges: IdentityEdge[] = [];
  readonly events: EventRow[] = [];
  /** workspace -> distinctKey -> override */
  private readonly overrides = new Map<string, Map<string, PersonOverride>>();

  async insertEdges(edges: readonly IdentityEdge[]): Promise<void> {
    this.edges.push(...edges);
  }

  async exactEdgesTouching(workspaceId: string, distincts: readonly Distinct[]): Promise<IdentityEdge[]> {
    const wanted = new Set(distincts.map(distinctKey));
    return this.edges.filter(
      (e) =>
        e.workspace_id === workspaceId &&
        isExact(e.method) &&
        (wanted.has(distinctKey(e.from)) || wanted.has(distinctKey(e.to)))
    );
  }

  async getOverrides(workspaceId: string, distincts: readonly Distinct[]): Promise<Map<string, string>> {
    const byWorkspace = this.overrides.get(workspaceId);
    const out = new Map<string, string>();
    if (!byWorkspace) return out;
    for (const d of distincts) {
      const row = byWorkspace.get(distinctKey(d));
      if (row) out.set(distinctKey(d), row.person_id);
    }
    return out;
  }

  async putOverrides(rows: readonly PersonOverride[]): Promise<void> {
    for (const row of rows) {
      let byWorkspace = this.overrides.get(row.workspace_id);
      if (!byWorkspace) {
        byWorkspace = new Map();
        this.overrides.set(row.workspace_id, byWorkspace);
      }
      const key = distinctKey(row.distinct);
      const existing = byWorkspace.get(key);
      // Highest version wins, same as the ON CONFLICT rule in Postgres.
      if (!existing || existing.version <= row.version) byWorkspace.set(key, row);
    }
  }

  async pendingOverrides(limit = 10_000): Promise<PersonOverride[]> {
    const out: PersonOverride[] = [];
    for (const byWorkspace of this.overrides.values()) {
      for (const row of byWorkspace.values()) {
        out.push(row);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  async rewriteEventPersons(
    workspaceId: string,
    personId: string,
    distincts: readonly Distinct[]
  ): Promise<number> {
    const wanted = new Set(distincts.map(distinctKey));
    let n = 0;
    for (const ev of this.events) {
      if (ev.workspace_id !== workspaceId) continue;
      const hit =
        (ev.web_visitor_id && wanted.has("web_visitor " + ev.web_visitor_id)) ||
        (ev.install_id && wanted.has("install " + ev.install_id)) ||
        (ev.account_id && wanted.has("account " + ev.account_id));
      if (hit && ev.person_id !== personId) {
        ev.person_id = personId;
        n++;
      }
    }
    return n;
  }

  async deleteOverrides(rows: readonly PersonOverride[]): Promise<void> {
    for (const row of rows) {
      const byWorkspace = this.overrides.get(row.workspace_id);
      if (!byWorkspace) continue;
      const key = distinctKey(row.distinct);
      const existing = byWorkspace.get(key);
      // Only drop what we actually drained. A newer write during squash survives.
      if (existing && existing.version <= row.version) byWorkspace.delete(key);
    }
  }
}
