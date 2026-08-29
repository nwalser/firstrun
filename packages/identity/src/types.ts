/** The three kinds of id a client can assert about itself. */
export type DistinctType = "web_visitor" | "install" | "account";

export interface Distinct {
  type: DistinctType;
  id: string;
}

/**
 * How we came to believe two distincts are the same person.
 *
 *  - `token`    - the download token was carried in the installer filename and
 *                 claimed on first run. Exact.
 *  - `account`  - the same account id was seen on both surfaces. Exact.
 *  - `estimate` - IP + OS + a first-run-within-30-minutes window. NOT exact.
 *
 * See CLAUDE.md rule 1. Exact methods mutate `person_id`. `estimate` never does.
 */
export type EdgeMethod = "token" | "account" | "estimate";

export const EXACT_METHODS: readonly EdgeMethod[] = ["token", "account"];

export function isExact(method: EdgeMethod): method is "token" | "account" {
  return method === "token" || method === "account";
}

export interface IdentityEdge {
  workspace_id: string;
  from: Distinct;
  to: Distinct;
  method: EdgeMethod;
  /** 1.0 for exact methods. Strictly below 1 for estimates. */
  confidence: number;
  created_at: number;
}

export interface PersonOverride {
  workspace_id: string;
  distinct: Distinct;
  person_id: string;
  /** Monotonic per process. On conflict, the highest version wins. */
  version: number;
}

/** Stable map key for a distinct within a workspace. */
export function distinctKey(d: Distinct): string {
  return d.type + " " + d.id;
}

export function sameDistinct(a: Distinct, b: Distinct): boolean {
  return a.type === b.type && a.id === b.id;
}
