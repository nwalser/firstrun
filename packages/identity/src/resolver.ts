import { canonicalOf, seedPersonId } from "./person.js";
import type { IdentityStore } from "./store.js";
import type { Distinct, EdgeMethod, IdentityEdge, PersonOverride } from "./types.js";
import { distinctKey, isExact } from "./types.js";

export interface LinkResult {
  method: EdgeMethod;
  /**
   * The person the component now resolves to.
   *
   * `null` for `estimate`, and that is not an oversight: an estimated edge does
   * not produce a person. See CLAUDE.md rule 1.
   */
  person_id: string | null;
  /** Distincts whose effective person changed as a result of this link. */
  moved: Distinct[];
}

export interface ObserveInput {
  project_id: string;
  web_visitor_id?: string | null;
  install_id?: string | null;
  account_id?: string | null;
}

/**
 * Person resolution. The only thing in the codebase allowed to decide what
 * `person_id` an event carries.
 *
 * The graph is union-find shaped but is walked rather than cached, because the
 * components are tiny (a person owns a handful of distincts, not thousands) and
 * because a walk cannot go stale. What IS cached is the answer, in
 * `person_overrides`, so a query a second later is already correct without
 * waiting for the squash job.
 */
export class IdentityResolver {
  private lastVersion = 0;

  constructor(
    private readonly store: IdentityStore,
    private readonly now: () => number = Date.now
  ) {}

  /**
   * Every distinct reachable from `seeds` over exact edges.
   *
   * Estimate edges are excluded by the store, not by a filter here, so there is
   * exactly one place to get this wrong and it has a test on it.
   */
  async component(projectId: string, seeds: readonly Distinct[]): Promise<Distinct[]> {
    const seen = new Map<string, Distinct>();
    for (const s of seeds) seen.set(distinctKey(s), s);

    let frontier: Distinct[] = [...seeds];
    while (frontier.length > 0) {
      const edges = await this.store.exactEdgesTouching(projectId, frontier);
      const next: Distinct[] = [];
      for (const edge of edges) {
        for (const d of [edge.from, edge.to]) {
          const key = distinctKey(d);
          if (!seen.has(key)) {
            seen.set(key, d);
            next.push(d);
          }
        }
      }
      frontier = next;
    }
    return [...seen.values()];
  }

  /** The canonical person for a distinct. Lowest seed uuid in its component. */
  async resolve(projectId: string, distinct: Distinct): Promise<string> {
    const members = await this.component(projectId, [distinct]);
    return canonicalOf(members.map((m) => seedPersonId(projectId, m)));
  }

  /**
   * Record that two distincts are the same person.
   *
   * Exact methods write the edge, recompute the component, and write
   * `person_overrides` immediately so queries are correct within a second
   * rather than within a squash interval.
   *
   * `estimate` writes the edge and stops. It does not resolve, does not write
   * overrides, and does not touch any person id.
   */
  async link(
    projectId: string,
    from: Distinct,
    to: Distinct,
    method: EdgeMethod,
    confidence?: number
  ): Promise<LinkResult> {
    const exact = isExact(method);
    const conf = confidence ?? (exact ? 1 : 0.5);

    if (exact && conf !== 1) {
      throw new Error(`exact method '${method}' must have confidence 1, got ${conf}`);
    }
    if (!exact && conf >= 1) {
      throw new Error(`estimate edges must have confidence below 1, got ${conf}`);
    }

    const edge: IdentityEdge = {
      project_id: projectId,
      from,
      to,
      method,
      confidence: conf,
      created_at: this.now(),
    };
    await this.store.insertEdges([edge]);

    if (!exact) {
      // Deliberate dead end. An estimate is a hint for aggregate funnel maths,
      // never an assertion about who someone is.
      return { method, person_id: null, moved: [] };
    }

    const members = await this.component(projectId, [from, to]);
    const canonical = canonicalOf(members.map((m) => seedPersonId(projectId, m)));

    const existing = await this.store.getOverrides(projectId, members);
    const version = this.nextVersion();
    const rows: PersonOverride[] = [];
    const moved: Distinct[] = [];

    for (const m of members) {
      const key = distinctKey(m);
      const effective = existing.get(key) ?? seedPersonId(projectId, m);
      if (effective === canonical) continue;
      rows.push({ project_id: projectId, distinct: m, person_id: canonical, version });
      moved.push(m);
    }

    if (rows.length > 0) await this.store.putOverrides(rows);

    return { method, person_id: canonical, moved };
  }

  /**
   * What ingest calls for every event.
   *
   * An `account_id` seen alongside another distinct IS an exact join - that is
   * step 3 of the join, "confirm on login" - so we record it here rather than
   * making every caller remember to. Then we resolve.
   */
  async observe(input: ObserveInput): Promise<string> {
    const { project_id } = input;
    const web = input.web_visitor_id ? ({ type: "web_visitor", id: input.web_visitor_id } as const) : null;
    const install = input.install_id ? ({ type: "install", id: input.install_id } as const) : null;
    const account = input.account_id ? ({ type: "account", id: input.account_id } as const) : null;

    if (account) {
      if (install) await this.linkIfNew(project_id, install, account, "account");
      if (web) await this.linkIfNew(project_id, web, account, "account");
    }

    const primary = install ?? web ?? account;
    if (!primary) throw new Error("an event needs at least one distinct to belong to a person");
    return this.resolve(project_id, primary);
  }

  /** Avoid rewriting the same account edge on every single event. */
  private async linkIfNew(
    projectId: string,
    a: Distinct,
    b: Distinct,
    method: EdgeMethod
  ): Promise<void> {
    const members = await this.component(projectId, [a]);
    const bKey = distinctKey(b);
    if (members.some((m) => distinctKey(m) === bKey)) return;
    await this.link(projectId, a, b, method);
  }

  private nextVersion(): number {
    const v = Math.max(this.now(), this.lastVersion + 1);
    this.lastVersion = v;
    return v;
  }
}
