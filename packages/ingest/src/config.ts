export interface IngestConfig {
  /**
   * Origin the tag and the SDKs talk to. Customers CNAME a subdomain at this.
   *
   * It is where a batch is POSTed and where `/t.js` is served from, and that is
   * all. firstrun does not sit in front of a download, an installer, or any
   * other asset a customer ships: if this origin is unreachable, nothing on
   * their site or in their app stops working.
   */
  publicOrigin: string;
  /**
   * Largest body the event endpoint will read.
   *
   * Intake is public and unauthenticated, so the cheapest thing it can do with
   * an oversized body is refuse to hold it. `MAX_BATCH_ENTRIES` caps a batch at
   * 500 entries and the attribute bounds cap what one entry can carry, so a
   * megabyte is already far more than a well-behaved client can produce.
   */
  maxBodyBytes: number;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): IngestConfig {
  return {
    publicOrigin: (env.PUBLIC_ORIGIN ?? env.PUBLIC_INGEST_ORIGIN ?? "http://localhost:3000").replace(
      /\/$/,
      ""
    ),
    maxBodyBytes: Number(env.INGEST_MAX_BODY_BYTES ?? 1_000_000),
  };
}
