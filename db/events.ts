import type { StoredEvent } from "@firstrun/schema";
import { ClickHouseClient, toChDateTime } from "./clickhouse/client.js";

/**
 * The one place an envelope becomes a ClickHouse row.
 *
 * Both timestamps are written. `event_time` came from the client and is what
 * every query buckets on; `ingest_time` is ours and is only ever read while
 * debugging. See CLAUDE.md rule 2.
 */
export function toEventRow(e: StoredEvent): Record<string, unknown> {
  return {
    project_id: e.project_id,
    event_id: e.event_id,
    event_name: e.event_name,
    event_time: toChDateTime(e.event_time),
    ingest_time: toChDateTime(e.ingest_time),
    surface: e.surface,
    person_id: e.person_id,
    web_visitor_id: e.web_visitor_id,
    install_id: e.install_id,
    account_id: e.account_id,
    session_id: e.session_id,
    app_version: e.app_version,
    channel: e.channel,
    os: e.os,
    arch: e.arch,
    locale: e.locale,
    url: e.url,
    referrer: e.referrer,
    utm_source: e.utm_source,
    utm_medium: e.utm_medium,
    utm_campaign: e.utm_campaign,
    props: e.props,
  };
}

export async function insertEvents(ch: ClickHouseClient, events: readonly StoredEvent[]): Promise<void> {
  if (events.length === 0) return;
  await ch.insert("events", events.map(toEventRow));
}
