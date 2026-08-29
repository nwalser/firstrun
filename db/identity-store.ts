import type {
  Distinct,
  DistinctType,
  IdentityEdge,
  IdentityStore,
  PersonOverride,
} from "@firstrun/identity";
import { distinctKey } from "@firstrun/identity";
import type { Queryable } from "./client.js";

/**
 * The Postgres implementation of `IdentityStore`.
 *
 * Satisfies the interface structurally rather than by extending anything, so
 * `@firstrun/identity` stays free of any database and stays testable in memory.
 * If this file and the memory store ever disagree, the memory store is the
 * specification.
 *
 * The interesting consequence of moving off ClickHouse is `rewriteEventPersons`:
 * it used to be an asynchronous mutation you had to wait on and could not count,
 * and is now an ordinary UPDATE that reports its own row count and rolls back
 * with whatever transaction surrounds it.
 */
export class PostgresIdentityStore implements IdentityStore {
  constructor(private readonly sql: Queryable) {}

  async insertEdges(edges: readonly IdentityEdge[]): Promise<void> {
    if (edges.length === 0) return;

    const params: unknown[] = [];
    const rows = edges.map((e) => {
      const base = params.length;
      params.push(
        e.workspace_id,
        e.from.type,
        e.from.id,
        e.to.type,
        e.to.id,
        e.method,
        e.confidence,
        new Date(e.created_at)
      );
      return `($${base + 1}::uuid, $${base + 2}::distinct_type, $${base + 3}, $${base + 4}::distinct_type, $${base + 5}, $${base + 6}::edge_method, $${base + 7}, $${base + 8})`;
    });

    // The natural key is the edge itself, so re-claiming a token or re-sending
    // an account edge collapses instead of accumulating.
    await this.sql.query(
      `INSERT INTO identity_edges
         (workspace_id, from_type, from_id, to_type, to_id, method, confidence, created_at)
       VALUES ${rows.join(", ")}
       ON CONFLICT (workspace_id, method, from_type, from_id, to_type, to_id) DO NOTHING`,
      params
    );
  }

  /**
   * Exact edges only.
   *
   * The `method IN ('token','account')` filter is the chokepoint for CLAUDE.md
   * rule 1 on this side of the system. An estimate edge that reached traversal
   * would silently merge two real people, so it is excluded here rather than
   * anywhere a caller could forget.
   */
  async exactEdgesTouching(
    workspaceId: string,
    distincts: readonly Distinct[]
  ): Promise<IdentityEdge[]> {
    if (distincts.length === 0) return [];
    const keys = distincts.map(distinctKey);

    const rows = await this.sql.query<{
      from_type: DistinctType;
      from_id: string;
      to_type: DistinctType;
      to_id: string;
      method: "token" | "account";
      confidence: number;
      created_at: Date;
    }>(
      `SELECT from_type, from_id, to_type, to_id, method, confidence, created_at
         FROM identity_edges
        WHERE workspace_id = $1
          AND method IN ('token', 'account')
          AND ( (from_type::text || ' ' || from_id) = ANY($2::text[])
             OR (to_type::text   || ' ' || to_id)   = ANY($2::text[]) )`,
      [workspaceId, keys]
    );

    return rows.map((r) => ({
      workspace_id: workspaceId,
      from: { type: r.from_type, id: r.from_id },
      to: { type: r.to_type, id: r.to_id },
      method: r.method,
      confidence: r.confidence,
      created_at: r.created_at.getTime(),
    }));
  }

  async getOverrides(
    workspaceId: string,
    distincts: readonly Distinct[]
  ): Promise<Map<string, string>> {
    if (distincts.length === 0) return new Map();
    const rows = await this.sql.query<{
      distinct_type: DistinctType;
      distinct_id: string;
      person_id: string;
    }>(
      `SELECT distinct_type, distinct_id, person_id
         FROM person_overrides
        WHERE workspace_id = $1
          AND (distinct_type::text || ' ' || distinct_id) = ANY($2::text[])`,
      [workspaceId, distincts.map(distinctKey)]
    );
    return new Map(rows.map((r) => [r.distinct_type + " " + r.distinct_id, r.person_id]));
  }

  async putOverrides(rows: readonly PersonOverride[]): Promise<void> {
    if (rows.length === 0) return;

    const params: unknown[] = [];
    const values = rows.map((r) => {
      const base = params.length;
      params.push(r.workspace_id, r.distinct.type, r.distinct.id, r.person_id, r.version);
      return `($${base + 1}::uuid, $${base + 2}::distinct_type, $${base + 3}, $${base + 4}::uuid, $${base + 5})`;
    });

    // Highest version wins, so an older write arriving late cannot undo a newer
    // merge.
    await this.sql.query(
      `INSERT INTO person_overrides (workspace_id, distinct_type, distinct_id, person_id, version)
       VALUES ${values.join(", ")}
       ON CONFLICT (workspace_id, distinct_type, distinct_id) DO UPDATE
          SET person_id = EXCLUDED.person_id, version = EXCLUDED.version
        WHERE person_overrides.version <= EXCLUDED.version`,
      params
    );
  }

  async pendingOverrides(limit = 10_000): Promise<PersonOverride[]> {
    const rows = await this.sql.query<{
      workspace_id: string;
      distinct_type: DistinctType;
      distinct_id: string;
      person_id: string;
      version: string;
    }>(
      `SELECT workspace_id, distinct_type, distinct_id, person_id, version
         FROM person_overrides
        ORDER BY workspace_id, distinct_type, distinct_id
        LIMIT $1`,
      [limit]
    );
    return rows.map((r) => ({
      workspace_id: r.workspace_id,
      distinct: { type: r.distinct_type, id: r.distinct_id },
      person_id: r.person_id,
      version: Number(r.version),
    }));
  }

  /** The UPDATE squash exists to perform. Returns rows actually changed. */
  async rewriteEventPersons(
    workspaceId: string,
    personId: string,
    distincts: readonly Distinct[]
  ): Promise<number> {
    const web = distincts.filter((d) => d.type === "web_visitor").map((d) => d.id);
    const install = distincts.filter((d) => d.type === "install").map((d) => d.id);
    const account = distincts.filter((d) => d.type === "account").map((d) => d.id);
    if (web.length + install.length + account.length === 0) return 0;

    const rows = await this.sql.query<{ event_id: string }>(
      `UPDATE events
          SET person_id = $2
        WHERE workspace_id = $1
          AND person_id <> $2
          AND ( web_visitor_id = ANY($3::text[])
             OR install_id     = ANY($4::text[])
             OR account_id     = ANY($5::text[]) )
      RETURNING event_id`,
      [workspaceId, personId, web, install, account]
    );
    return rows.length;
  }

  async deleteOverrides(rows: readonly PersonOverride[]): Promise<void> {
    if (rows.length === 0) return;
    // Only drop up to the version we actually drained. An override written while
    // the update was running has a higher version and survives to the next run
    // rather than being lost.
    const maxVersion = rows.reduce((m, r) => Math.max(m, r.version), 0);
    await this.sql.query(
      `DELETE FROM person_overrides
        WHERE workspace_id = $1
          AND (distinct_type::text || ' ' || distinct_id) = ANY($2::text[])
          AND version <= $3`,
      [rows[0]!.workspace_id, rows.map((r) => distinctKey(r.distinct)), maxVersion]
    );
  }
}
