import { createHash } from "node:crypto";
import { candidateHints } from "@firstrun/db";
import type { Distinct } from "@firstrun/identity";
import type { Ctx } from "./context.js";

/**
 * Step 4 of the join: the installs that arrive with no token.
 *
 * A store, winget or shared-link install never carried a filename to read a
 * token out of. All we have is that the same network downloaded the same OS
 * build a few minutes earlier. That is circumstantial, so what comes out is an
 * `estimate` edge with confidence below 1, which the resolver refuses to walk
 * and the funnel reports as its own number. See CLAUDE.md rule 1.
 */

export interface EstimateResult {
  matched: boolean;
  confidence: number;
  candidates: number;
  web_visitor_id: string | null;
  /** Why we declined, when we declined. Worth logging; nothing branches on it. */
  reason?: "no-ip" | "no-candidates" | "too-ambiguous";
}

/**
 * Hashed, salted, and never stored next to anything else.
 *
 * The raw address is not written anywhere. This exists to be compared against
 * another hash of the same address for thirty minutes.
 */
export function hashIp(salt: string, projectId: string, ip: string): string {
  return createHash("sha256")
    .update(salt)
    .update("\0")
    .update(projectId)
    .update("\0")
    .update(ip)
    .digest("hex");
}

/**
 * Confidence falls off with ambiguity rather than being a flat constant,
 * because "one person on this network downloaded in the last half hour" and
 * "three people did" are not the same claim. Past `estimateMaxCandidates` we
 * decline instead of guessing badly.
 */
export function confidenceFor(candidates: number): number {
  return Math.min(0.9, 0.8 / candidates);
}

export async function estimateFirstRun(
  ctx: Ctx,
  args: { projectId: string; installId: string; os: string | null; ip: string | null; at: number }
): Promise<EstimateResult> {
  const none = (reason: EstimateResult["reason"]): EstimateResult => ({
    matched: false,
    confidence: 0,
    candidates: 0,
    web_visitor_id: null,
    reason,
  });

  if (!args.ip) return none("no-ip");

  const ipHash = hashIp(ctx.config.ipHashSalt, args.projectId, args.ip);
  const candidates = await candidateHints(
    ctx.store.db,
    args.projectId,
    ipHash,
    args.os,
    new Date(args.at - ctx.config.estimateWindowMs),
    new Date(args.at)
  );

  if (candidates.length === 0) return none("no-candidates");
  if (candidates.length > ctx.config.estimateMaxCandidates) {
    return { ...none("too-ambiguous"), candidates: candidates.length };
  }

  // Newest first, same as the Downloads-folder fallback: the most recent
  // download from this network is the likeliest to be the one that just ran.
  const best = candidates[0]!;
  const confidence = confidenceFor(candidates.length);

  const from: Distinct = { type: "install", id: args.installId };
  const to: Distinct = { type: "web_visitor", id: best.webVisitorId };
  await ctx.resolver.link(args.projectId, from, to, "estimate", confidence);

  return {
    matched: true,
    confidence,
    candidates: candidates.length,
    web_visitor_id: best.webVisitorId,
  };
}
