import type {
  Distinct,
  DistinctType,
  IdentityEdge,
  IdentityStore,
  PersonOverride,
} from "@firstrun/identity";
import { distinctKey } from "@firstrun/identity";
import { ClickHouseClient, toChDateTime } from "./client.js";

/**
 * The ClickHouse implementation of `IdentityStore`.
 *
 * Satisfies the interface structurally rather than by importing a base class,
 * so `@firstrun/identity` stays free of any database and stays testable in
 * memory. If this file and the memory store ever disagree, the memory store is
 * the specification.
 */
export class ClickHouseIdentityStore implements IdentityStore {
  constructor(private readonly ch: ClickHouseClient) {}

  async insertEdges(edges: readonly IdentityEdge[]): Promise<void> {
    if (edges.length === 0) return;
    await this.ch.insert(
      "identity_edges",
      edges.map((e) => ({
        project_id: e.project_id,
        from_type: e.from.type,
        from_id: e.from.id,
        to_type: e.to.type,
        to_id: e.to.id,
        method: e.method,
        confidence: e.confidence,
        created_at: toChDateTime(e.created_at),
      }))
    );
  }

  /**
   * Exact edges only.
   *
   * The `method IN ('token','account')` filter is the chokepoint for CLAUDE.md
   * rule 1 on this side of the system. An estimate edge that reached traversal
   * would silently merge two real people, so it is excluded here rather than
   * anywhere the caller could forget.
   */
  async exactEdgesTouching(projectId: string, distincts: readonly Distinct[]): Promise<IdentityEdge[]> {
    if (distincts.length === 0) return [];
    const keys = distincts.map(distinctKey);

    const rows = await this.ch.query<{
      from_type: DistinctType;
      from_id: string;
      to_type: DistinctType;
      to_id: string;
      method: "token" | "account";
      confidence: number;
      created_at: string;
    }>(
      `SELECT from_type, from_id, to_type, to_id, method, confidence, created_at
         FROM identity_edges FINAL
        WHERE project_id = {project:UUID}
          AND method IN ('token', 'account')
          AND ( concat(toString(from_type), ' ', from_id) IN {keys:Array(String)}
             OR concat(toString(to_type),   ' ', to_id)   IN {keys:Array(String)} )`,
      { project: projectId, keys: chArray(keys) }
    );

    return rows.map((r) => ({
      project_id: projectId,
      from: { type: r.from_type, id: r.from_id },
      to: { type: r.to_type, id: r.to_id },
      method: r.method,
      confidence: r.confidence,
      created_at: Date.parse(r.created_at.replace(" ", "T") + "Z"),
    }));
  }

  async getOverrides(projectId: string, distincts: readonly Distinct[]): Promise<Map<string, string>> {
    if (distincts.length === 0) return new Map();
    const rows = await this.ch.query<{
      distinct_type: DistinctType;
      distinct_id: string;
      person_id: string;
    }>(
      `SELECT distinct_type, distinct_id, person_id
         FROM person_overrides FINAL
        WHERE project_id = {project:UUID}
          AND concat(toString(distinct_type), ' ', distinct_id) IN {keys:Array(String)}`,
      { project: projectId, keys: chArray(distincts.map(distinctKey)) }
    );
    return new Map(rows.map((r) => [r.distinct_type + " " + r.distinct_id, r.person_id]));
  }

  async putOverrides(rows: readonly PersonOverride[]): Promise<void> {
    if (rows.length === 0) return;
    await this.ch.insert(
      "person_overrides",
      rows.map((r) => ({
        project_id: r.project_id,
        distinct_type: r.distinct.type,
        distinct_id: r.distinct.id,
        person_id: r.person_id,
        version: r.version,
      }))
    );
  }

  async pendingOverrides(limit = 10_000): Promise<PersonOverride[]> {
    const rows = await this.ch.query<{
      project_id: string;
      distinct_type: DistinctType;
      distinct_id: string;
      person_id: string;
      version: string | number;
    }>(
      `SELECT project_id, distinct_type, distinct_id, person_id, version
         FROM person_overrides FINAL
        ORDER BY project_id, distinct_type, distinct_id
        LIMIT {limit:UInt32}`,
      { limit }
    );
    return rows.map((r) => ({
      project_id: r.project_id,
      distinct: { type: r.distinct_type, id: r.distinct_id },
      person_id: r.person_id,
      version: Number(r.version),
    }));
  }

  /**
   * The mutation squash exists to perform.
   *
   * Counted before it is run because a ClickHouse mutation does not report how
   * many rows it touched, and a squash that silently rewrites nothing is worth
   * noticing. `mutations_sync=1` so the job's own report is true by the time it
   * returns rather than eventually.
   */
  async rewriteEventPersons(
    projectId: string,
    personId: string,
    distincts: readonly Distinct[]
  ): Promise<number> {
    if (distincts.length === 0) return 0;

    const web = chArray(distincts.filter((d) => d.type === "web_visitor").map((d) => d.id));
    const install = chArray(distincts.filter((d) => d.type === "install").map((d) => d.id));
    const account = chArray(distincts.filter((d) => d.type === "account").map((d) => d.id));

    const predicate = `project_id = {project:UUID}
        AND person_id != {person:UUID}
        AND ( web_visitor_id IN {web:Array(String)}
           OR install_id     IN {install:Array(String)}
           OR account_id     IN {account:Array(String)} )`;
    const params = { project: projectId, person: personId, web, install, account };

    const counted = await this.ch.queryOne<{ n: string | number }>(
      `SELECT count() AS n FROM events WHERE ${predicate}`,
      params
    );
    const n = Number(counted.n);
    if (n === 0) return 0;

    await this.ch.command(
      `ALTER TABLE events UPDATE person_id = {person:UUID} WHERE ${predicate} SETTINGS mutations_sync = 1`,
      params
    );
    return n;
  }

  async deleteOverrides(rows: readonly PersonOverride[]): Promise<void> {
    if (rows.length === 0) return;
    const projectId = rows[0]!.project_id;
    // Only drop up to the version we actually drained. An override written
    // while the mutation was running has a higher version and survives to the
    // next run rather than being lost.
    const maxVersion = rows.reduce((m, r) => Math.max(m, r.version), 0);
    await this.ch.command(
      `DELETE FROM person_overrides
        WHERE project_id = {project:UUID}
          AND concat(toString(distinct_type), ' ', distinct_id) IN {keys:Array(String)}
          AND version <= {version:UInt64}`,
      { project: projectId, keys: chArray(rows.map((r) => distinctKey(r.distinct))), version: maxVersion }
    );
  }
}

/** ClickHouse reads array parameters in its own text format, not JSON. */
export function chArray(values: readonly string[]): string {
  return "[" + values.map((v) => "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'").join(",") + "]";
}
