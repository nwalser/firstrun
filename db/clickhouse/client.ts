/**
 * A ClickHouse client that is nothing but `fetch` against the HTTP interface.
 *
 * Deliberately dependency-free: the deployment decision is "self-host-shaped,
 * no managed-service dependencies", and a driver that speaks the native
 * protocol is one more thing to keep alive in a docker compose someone else
 * runs. HTTP + JSONEachRow is enough for the shape of load this sees.
 */

export interface ClickHouseConfig {
  url: string;
  database: string;
  user: string;
  password: string;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): ClickHouseConfig {
  return {
    url: env.CLICKHOUSE_URL ?? "http://localhost:8123",
    database: env.CLICKHOUSE_DB ?? "firstrun",
    user: env.CLICKHOUSE_USER ?? "firstrun",
    password: env.CLICKHOUSE_PASSWORD ?? "firstrun",
  };
}

export class ClickHouseError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly sql: string
  ) {
    super(message);
    this.name = "ClickHouseError";
  }
}

/** Query parameter values, bound as ClickHouse `{name:Type}` placeholders. */
export type ChParams = Record<string, string | number | boolean>;

const DEFAULT_SETTINGS: Record<string, string> = {
  // Lets us hand ClickHouse ISO-8601 timestamps rather than its own format.
  date_time_input_format: "best_effort",
  // A null in a Nullable column stays null instead of becoming the type default.
  input_format_null_as_default: "0",
};

export class ClickHouseClient {
  constructor(private readonly config: ClickHouseConfig = configFromEnv()) {}

  /** SELECT. Returns parsed rows. */
  async query<T = Record<string, unknown>>(sql: string, params: ChParams = {}): Promise<T[]> {
    const body = sql.trim().replace(/;\s*$/, "") + "\nFORMAT JSONEachRow";
    const text = await this.send(body, params);
    if (!text.trim()) return [];
    return text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as T);
  }

  /** Exactly one row, or a clear error. Saves every caller writing `rows[0]!`. */
  async queryOne<T = Record<string, unknown>>(sql: string, params: ChParams = {}): Promise<T> {
    const rows = await this.query<T>(sql, params);
    if (rows.length !== 1) throw new Error(`expected exactly 1 row, got ${rows.length}`);
    return rows[0]!;
  }

  /** DDL, ALTER, INSERT ... SELECT. Anything with no rows to read back. */
  async command(sql: string, params: ChParams = {}): Promise<void> {
    await this.send(sql, params);
  }

  /** Bulk insert as JSONEachRow. */
  async insert(table: string, rows: readonly unknown[]): Promise<void> {
    if (rows.length === 0) return;
    const ndjson = rows.map((r) => JSON.stringify(r)).join("\n");
    await this.send(`INSERT INTO ${table} FORMAT JSONEachRow\n${ndjson}`, {});
  }

  /** True once the server answers /ping. Used by migrate and by tests. */
  async ping(timeoutMs = 1000): Promise<boolean> {
    try {
      const res = await fetch(new URL("/ping", this.config.url), {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Same server, different database. Used to create the database itself. */
  withDatabase(database: string): ClickHouseClient {
    return new ClickHouseClient({ ...this.config, database });
  }

  private async send(body: string, params: ChParams): Promise<string> {
    const url = new URL(this.config.url);
    url.searchParams.set("database", this.config.database);
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) url.searchParams.set(k, v);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(`param_${k}`, String(v));

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-ClickHouse-User": this.config.user,
        "X-ClickHouse-Key": this.config.password,
        "Content-Type": "text/plain; charset=utf-8",
      },
      body,
    });

    const text = await res.text();
    if (!res.ok) {
      throw new ClickHouseError(text.trim().split("\n")[0] ?? `HTTP ${res.status}`, res.status, body);
    }
    return text;
  }
}

/**
 * ClickHouse's own DateTime64(3) text format, UTC, no zone suffix.
 *
 * Not ISO-8601: query parameters are parsed strictly by type and reject the
 * trailing `Z` that `toISOString()` adds. Everything in this system is UTC.
 */
export function toChDateTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}

/** And hands back `2026-08-28 12:00:00.000` on the way out. */
export function fromChDateTime(value: string): number {
  return Date.parse(value.includes("T") ? value : value.replace(" ", "T") + "Z");
}
