import { Link, createFileRoute, notFound, redirect, useNavigate } from "@tanstack/solid-router";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import ScrollText from "lucide-solid/icons/scroll-text";
import Trash2 from "lucide-solid/icons/trash-2";
import { For, Show, type JSX } from "solid-js";
import { IngestHistogram, ingestTotal } from "../components/ingest-histogram.js";
import { IngestKeyCell } from "../components/ingest-key.js";
import { InstallGuideLink } from "../components/install-guide.js";
import { PageHeader } from "../components/page-header.js";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDelete,
  buttonVariants,
  toast,
} from "../components/ui/index.js";
import { cn } from "../lib/cn.js";
import { deleteSourceFn, getSession, getSourceDetail } from "../lib/api.js";
import { useI18n } from "../lib/i18n/index.js";
import { Route as ProjectRoute } from "./w.$wslug.$pslug.js";

/**
 * One source, on its own page.
 *
 * A source is the thing a customer actually installs, and the question they
 * come back with a week later is not "when was it last seen" -- the list
 * answers that -- but "is it sending what I think it is". That needs two things
 * a list has no room for: the shape of its month, and what it calls the events
 * it writes.
 *
 * It used to end with the last few events in full. That is the event log's job,
 * and the log does it better: it filters, it pages, it follows live, and it is
 * one click away in the header. Eight rows here were a worse version of a tool
 * that already exists, and they cost a feed query on every load of a page whose
 * question is "is this arriving", not "what did it say".
 *
 * Everything measured here goes through the QUERY LAYER, filtered on the
 * attribute the edge stamps (`firstrun.source.id`). That is deliberate: this
 * page reaches no number a customer could not have asked for on a card of their
 * own, which is the rule the whole product is built on.
 *
 * It has no notion of what KIND of thing the source is. A source is whatever
 * the customer pointed the key at, and the install guide is a link into the
 * documentation index with this source preselected rather than a guess at which
 * client they are using.
 *
 * It only READS, apart from removing the source. What a source sends is decided
 * by the software holding the key, and there is nothing on this page that
 * reaches back into it.
 */
export const Route = createFileRoute("/w/$wslug/$pslug/sources/$sid")({
  loader: async ({ params }) => {
    const session = await getSession();
    if (!session.user) throw redirect({ to: "/login" });
    const scope = { workspace: params.wslug, project: params.pslug, sourceId: params.sid };
    const view = await getSourceDetail({ data: scope });
    // A deleted source, or an id belonging to another project. Both are a
    // not-found rather than an error: the safe direction to fail in.
    if (!view) throw notFound();
    return view;
  },
  component: SourcePage,
});

function SourcePage() {
  const i18n = useI18n();
  const view = Route.useLoaderData();
  const nav = ProjectRoute.useLoaderData();
  const params = Route.useParams();
  const navigate = useNavigate();


  const workspace = () => params().wslug;
  const isAdmin = () => nav().role === "admin";
  const total = () => ingestTotal(view().daily);

  /** The biggest name, so every bar beside a name has something to be a share of. */
  const busiest = () => Math.max(1, ...view().names.map((n) => n.entries));

  async function remove() {
    const result = await deleteSourceFn({
      data: {
        workspace: workspace(),
        project: view().projectSlug,
        sourceId: view().id,
      },
    });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    // Back to the list: the page this was on no longer describes anything.
    await navigate({
      to: "/w/$wslug/$pslug/sources",
      params: { wslug: workspace(), pslug: view().projectSlug },
    });
  }

  return (
    <main class="w-full py-4">
      <PageHeader
        title={view().name}
        description={i18n.t("sources.detail_hint")}
        actions={
          <>
            {/*
              The log, pre-filtered to this source. A link rather than a list:
              the page says whether events are arriving and what they are called,
              and reading them is what the log is for.
            */}
            <Link
              to="/w/$wslug/events"
              params={{ wslug: workspace() }}
              search={{ source: view().id, project: view().projectSlug }}
              class={buttonVariants({ variant: "outline", size: "toolbar" })}
            >
              <ScrollText class="size-4" />
              {i18n.t("sources.open_log")}
            </Link>
            <Link
              to="/w/$wslug/$pslug/sources"
              params={{ wslug: workspace(), pslug: view().projectSlug }}
              class={buttonVariants({ variant: "outline", size: "toolbar" })}
            >
              <ArrowLeft class="size-4" />
              {i18n.t("sources.back_to_list")}
            </Link>
          </>
        }
        filters={
          <>
            <Badge variant="secondary" class="h-8 rounded-md px-2.5 text-body font-normal">
              <span class="text-muted-foreground">{i18n.t("sources.project_label")}:</span>
              {view().projectName}
            </Badge>
            <Badge variant="secondary" class="h-8 rounded-md px-2.5 text-body font-normal">
              <Show when={view().lastSeenAt} fallback={i18n.t("sources.never_seen")}>
                {(at) => <>{i18n.t("sources.seen", { when: i18n.relative(at()) })}</>}
              </Show>
            </Badge>
            <Badge variant="outline" class="h-8 rounded-md px-2.5 text-body font-normal">
              {i18n.t("sources.ingest_30d", { count: total() })}
            </Badge>
          </>
        }
      />

      <div class="flex flex-col gap-4">
        {/*
          One column becoming two: the month and the key are read side by side
          when there is room, because "is it arriving" and "is this the key I
          deployed" are the same visit. A container query on the shell's page
          pane, never the viewport.
        */}
        <div class="grid grid-cols-1 gap-4 @lg-page/page:grid-cols-2">
          <Card>
            <CardHeader>
              <div class="min-w-0">
                <CardTitle>{i18n.t("sources.activity")}</CardTitle>
                <div class="mt-0.5 text-caption text-muted-foreground">
                  {i18n.dateRange(view().from, view().to)}
                </div>
              </div>
              <span class="shrink-0 text-body tabular-nums">{i18n.num(total())}</span>
            </CardHeader>
            <CardContent class="flex flex-col gap-2">
              {/* The tile has the card's whole width, so it gets a height to
                  match it: at 64 a nine-hundred-pixel chart was a strip. */}
              <IngestHistogram
                daily={view().daily}
                height={128}
                label={i18n.t("sources.ingest_30d", { count: total() })}
              />
              {/*
                On `time`, so this is when the source was last ACTIVE rather
                than when we last heard from it. A desktop client replaying a
                week-old queue was last used a week ago.
              */}
              <div class="flex items-baseline justify-between text-caption text-muted-foreground">
                <span>{i18n.t("sources.created_on", { date: i18n.shortDate(view().createdAt) })}</span>
                <Show when={view().lastSeenAt} fallback={<span>{i18n.t("sources.never_seen")}</span>}>
                  {(at) => <span>{i18n.t("sources.seen", { when: i18n.relative(at()) })}</span>}
                </Show>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{i18n.t("sources.key_label")}</CardTitle>
            </CardHeader>
            <CardContent class="flex flex-col gap-3">
              <IngestKeyCell value={view().ingestKey} />
              <p class="text-caption text-muted-foreground">{i18n.t("sources.key_hint")}</p>
              <InstallGuideLink sourceId={view().id} />
            </CardContent>
          </Card>
        </div>

        <div class="grid grid-cols-1 gap-4 @lg-page/page:grid-cols-2">
          {/* A group by on `name`, bounded. The customer's own vocabulary, read
              back to them rather than declared anywhere. */}
          <Card>
            <CardHeader>
              <CardTitle>{i18n.t("sources.what_it_sends")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Show
                when={view().names.length > 0}
                fallback={<Nothing>{i18n.t("sources.nothing_sent")}</Nothing>}
              >
                <ul class="flex flex-col">
                  <For each={view().names}>
                    {(row) => (
                      <li class="flex items-center gap-3 border-b py-1.5 text-caption last:border-b-0">
                        <span class="min-w-0 flex-1 truncate font-mono text-mono" title={row.name}>
                          {row.name}
                        </span>
                        {/* The bar is a share of the BIGGEST name, not of the
                            total: a list where every bar is 4% wide says
                            nothing about which of them leads. */}
                        <span class="hidden h-1.5 w-24 shrink-0 rounded-full bg-muted @md-page/page:block">
                          <span
                            class="block h-full rounded-full bg-chart-1"
                            style={{ width: `${Math.max(4, (row.entries / busiest()) * 100)}%` }}
                          />
                        </span>
                        <span class="w-16 shrink-0 text-right tabular-nums">
                          {i18n.num(row.entries)}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </CardContent>
          </Card>

          {/* The same question asked of the severity column: how much of this
              source's volume is noise, and how much is worth an alert. */}
          <Card>
            <CardHeader>
              <CardTitle>{i18n.t("sources.severity_mix")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Show
                when={view().severities.length > 0}
                fallback={<Nothing>{i18n.t("sources.nothing_sent")}</Nothing>}
              >
                <ul class="flex flex-col">
                  <For each={view().severities}>
                    {(row) => (
                      <li class="flex items-center gap-3 border-b py-1.5 text-caption last:border-b-0">
                        <span class="min-w-0 flex-1 truncate">{row.label}</span>
                        <span class="shrink-0 text-muted-foreground tabular-nums">
                          {i18n.share(row.entries, total()) ?? ""}
                        </span>
                        <span class="w-16 shrink-0 text-right tabular-nums">
                          {i18n.num(row.entries)}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </CardContent>
          </Card>
        </div>

        {/*
          Removing a source is the one action here that cannot be undone, so it
          sits under its own edge rather than beside the things that only read.
        */}
        <Show when={isAdmin()}>
          <Card class="shadow-none ring-1 ring-destructive/40">
            <CardHeader>
              <div class="min-w-0">
                <CardTitle class="text-negative">{i18n.t("sources.remove_source_title")}</CardTitle>
                <div class="mt-0.5 max-w-2xl text-caption text-muted-foreground">
                  {i18n.t("sources.remove_confirm_hint")}
                </div>
              </div>
              <ConfirmDelete
                trigger={
                  <Button variant="outline" size="sm" class="text-negative">
                    <Trash2 class="size-4" />
                    {i18n.t("sources.remove_action")}
                  </Button>
                }
                title={i18n.t("sources.remove_confirm_title", { name: view().name })}
                description={i18n.t("sources.remove_confirm_hint")}
                confirmWord={view().name}
                actionLabel={i18n.t("sources.remove_action")}
                onConfirm={() => remove()}
              />
            </CardHeader>
          </Card>
        </Show>
      </div>
    </main>
  );
}

/** What a card says when the window holds nothing for it. */
function Nothing(props: { children: JSX.Element }) {
  return (
    <div class={cn("py-6 text-center text-caption text-muted-foreground")}>{props.children}</div>
  );
}
