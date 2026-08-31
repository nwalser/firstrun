import { severityBand, severityText, type FeedEntry } from "@firstrun/schema";
import { ATTR, entryIdentity } from "@firstrun/schema/conventions";
import { Link, createFileRoute, notFound, redirect } from "@tanstack/solid-router";
import Antenna from "lucide-solid/icons/antenna";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import ScrollText from "lucide-solid/icons/scroll-text";
import UserRound from "lucide-solid/icons/user-round";
import { Show, type JSX } from "solid-js";
import { BAND_TONE, EntryAttributes, EntryFacts } from "../components/entry-row.js";
import { PageHeader } from "../components/page-header.js";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  buttonVariants,
} from "../components/ui/index.js";
import { cn } from "../lib/cn.js";
import { getEvent, getSession } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";

/**
 * One entry, on its own page.
 *
 * The log's row expands in place, which is how you READ a log. This is how you
 * cite one: an address somebody can paste into an issue, a chat message or a
 * commit, that opens on the entry itself rather than on a list they then have
 * to scroll and re-filter.
 *
 * It shows exactly what the opened row shows, out of the same two components,
 * so the two cannot drift. What it adds is the ways OUT: everything else by
 * that name, everything else that client sent, and the source that wrote it. An
 * entry on its own answers "what happened"; those answer "and what else", which
 * is the next question every single time.
 *
 * `at` in the search is the entry's own timestamp, and it is a hint rather than
 * a requirement: it turns the lookup into a primary-key hit on one partition,
 * and a link without it still resolves inside a bounded fallback window.
 * `project` is there so the shell reads this page at project scope, the same
 * way the log does. See `db/feed.ts` and `lib/scope.ts`.
 */
export const Route = createFileRoute("/w/$wslug/events/$eid")({
  validateSearch: (search: Record<string, unknown>): { at?: string; project?: string } => ({
    ...(typeof search.at === "string" && search.at ? { at: search.at } : {}),
    ...(typeof search.project === "string" && search.project
      ? { project: search.project }
      : {}),
  }),
  // Only `at` changes what the loader reads. `project` moves the shell's scope
  // and nothing else, so re-running the query for it would be a round trip for
  // a sidebar.
  loaderDeps: ({ search }) => ({ at: search.at }),
  loader: async ({ params, deps }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const entry = await getEvent({
      data: { workspace: params.wslug, entryId: params.eid, at: deps.at ?? null },
    });
    // A not-found rather than an empty page. An entry can genuinely be gone:
    // retention drops a partition and everything in it, which is the design
    // (rule 4) rather than an error to apologise for.
    if (!entry) throw notFound();
    return entry;
  },
  component: EventPage,
});

function EventPage() {
  const i18n = useI18n();
  const entry = Route.useLoaderData();
  const params = Route.useParams();

  const workspace = () => params().wslug;

  /** The source that wrote it, when the edge stamped one. */
  const sourceId = () => {
    const value = entry().attributes[ATTR.SOURCE_ID];
    return typeof value === "string" ? value : null;
  };

  return (
    <main class="w-full py-4">
      <PageHeader
        title={entry().name}
        description={i18n.t("events.detail_hint")}
        actions={
          <>
            <Link
              to="/w/$wslug/events"
              params={{ wslug: workspace() }}
              search={{ project: entry().projectSlug }}
              class={buttonVariants({ variant: "outline", size: "toolbar" })}
            >
              <ArrowLeft class="size-4" />
              {i18n.t("events.back_to_log")}
            </Link>
          </>
        }
        filters={
          <>
            {/*
              The three facts that place an entry, in the row a list page uses
              for its filters: how bad, whose, and when. Everything else is in
              the card below, where it is read rather than scanned.
            */}
            <Show when={entry().severity}>
              {(severity) => (
                <Badge variant="outline" class="h-8 rounded-md px-2.5 text-body font-normal">
                  <span class={cn("font-mono", BAND_TONE[severityBand(severity())])}>
                    {severityText(severity())}
                  </span>
                </Badge>
              )}
            </Show>
            <Badge variant="secondary" class="h-8 rounded-md px-2.5 text-body font-normal">
              <span class="text-muted-foreground">{i18n.t("events.col_project")}:</span>
              {entry().projectName}
            </Badge>
            <Badge variant="secondary" class="h-8 rounded-md px-2.5 text-body font-normal">
              {i18n.relative(entry().time)}
            </Badge>
          </>
        }
      />

      <div class="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>{i18n.t("events.detail_facts")}</CardTitle>
          </CardHeader>
          <CardContent>
            <EntryFacts entry={entry()} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{i18n.t("events.attributes")}</CardTitle>
          </CardHeader>
          <CardContent>
            <EntryAttributes entry={entry()} />
          </CardContent>
        </Card>

        {/*
          The ways out. Each is a filter on the log this entry came from, which
          is the point: nothing here reaches a view the reader could not have
          built by typing into the log's own search box.
        */}
        <Card>
          <CardHeader>
            <CardTitle>{i18n.t("events.related")}</CardTitle>
          </CardHeader>
          <CardContent class="flex flex-wrap gap-2">
            <Related
              workspace={workspace()}
              project={entry().projectSlug}
              query={entry().name}
              label={i18n.t("events.same_name", { name: entry().name })}
            >
              <ScrollText class="size-4 text-muted-foreground" />
            </Related>

            <Show when={entryIdentity(entry().attributes)}>
              {(id) => (
                <Related
                  workspace={workspace()}
                  project={entry().projectSlug}
                  query={id().value}
                  label={i18n.t("events.same_client")}
                >
                  <UserRound class="size-4 text-muted-foreground" />
                </Related>
              )}
            </Show>

            <Show when={sourceId()}>
              {(id) => (
                <Link
                  to="/w/$wslug/$pslug/sources/$sid"
                  params={{ wslug: workspace(), pslug: entry().projectSlug, sid: id() }}
                  class={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <Antenna class="size-4 text-muted-foreground" />
                  {i18n.t("events.open_source")}
                </Link>
              )}
            </Show>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

/**
 * A way back into the log, narrowed.
 *
 * The window is left at the log's own default rather than widened to reach this
 * entry's day: a link that quietly changed the range would answer a different
 * question from the one its label names.
 */
function Related(props: {
  workspace: string;
  project: string;
  query: string;
  label: string;
  children: JSX.Element;
}) {
  return (
    <Link
      to="/w/$wslug/events"
      params={{ wslug: props.workspace }}
      search={{ q: props.query, project: props.project }}
      class={buttonVariants({ variant: "outline", size: "sm" })}
    >
      {props.children}
      {props.label}
    </Link>
  );
}
