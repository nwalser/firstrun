export interface IngestConfig {
  port: number;
  /** Origin the tag and the SDK talk to. Customers CNAME a subdomain at this. */
  publicOrigin: string;
  /** Where /dl/<token>/<file> streams the real installer from. */
  assetOrigin: string | null;
  /**
   * Salt for hashing client IPs used in estimated matching.
   *
   * Must be stable across restarts or a redeploy loses 30 minutes of possible
   * matches. Must not be shared with anything else: the hashes are the only
   * network-identifying material this system keeps, and they exist purely to
   * be compared against each other for half an hour.
   */
  ipHashSalt: string;
  /** How far back a download can be and still be a candidate for a first run. */
  estimateWindowMs: number;
  /** More candidates than this in the window and the guess is not worth making. */
  estimateMaxCandidates: number;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): IngestConfig {
  return {
    port: Number(env.INGEST_PORT ?? 4318),
    publicOrigin: env.PUBLIC_INGEST_ORIGIN ?? `http://localhost:${env.INGEST_PORT ?? 4318}`,
    assetOrigin: env.ASSET_ORIGIN ?? null,
    ipHashSalt: env.IP_HASH_SALT ?? "dev-only-salt",
    estimateWindowMs: 30 * 60 * 1000,
    estimateMaxCandidates: 3,
  };
}
