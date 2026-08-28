import { ClickHouseClient } from "./db/clickhouse/client.js";
import { funnel, day7 } from "./db/queries.js";
const ch = new ClickHouseClient();
const p = "7f9b5c2e-1d4a-4f8b-9c3e-6a2b8d5f1e40";
const now = Date.now();
const w = { projectId: p, from: now - 31 * 864e5, to: now + 864e5 };
console.log(await funnel(ch, w));
console.log(await day7(ch, w));
