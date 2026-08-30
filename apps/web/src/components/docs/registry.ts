import type { JSX } from "solid-js";
import type { DocsSource } from "../../lib/api.js";
import type { SimpleKey, TFn } from "../../lib/i18n/index.js";

/**
 * Every page in the documentation, in one list.
 *
 * Pages are Solid components rather than markdown, and that is the whole
 * design: a snippet has to arrive carrying the reader's own ingest key, and a
 * markdown runtime can only ever hand back a string somebody has to edit before
 * pasting. A plain TypeScript registry also means the table of contents, the
 * the table of contents and the not-found page read from the same array
 * instead of two lists that drift.
 *
 * A page is registered by dropping a file into `./topics/` that exports
 * `topics`. Nothing here needs editing to add one -- see `discover()`.
 *
 * Because this module imports those files, a page file must import **types
 * only** from here. Importing a value and using it at the top level of a page
 * module is a circular import that fails at start-up rather than at the call
 * site. `steps.js`, `snippet.js` and `shell.js` are all safe to import
 * normally: they touch this module only inside function bodies.
 */

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

/**
 * The sections, in the order the contents shows them.
 *
 * `DocsSection` is a union of these four strings rather than a free string, so
 * two pages cannot land in "Getting started" and "Getting Started" and split
 * the contents in half. A page writes the literal:
 *
 * ```ts
 * section: "Install guides",
 * ```
 *
 * There is deliberately no `SECTIONS` constant to import. This module eagerly
 * imports every page (see `discover()`), so a page importing a *value* back out
 * of it and using that value while the page's own module is initialising reads
 * a binding that is still in its temporal dead zone -- and the whole documentation dies
 * with a `Cannot access '...' before initialization` that names nothing useful.
 * Types are erased and cost nothing, so a page imports types from here and
 * spells section names as literals. Do not add a constant back.
 */
export const DOCS_SECTIONS = [
  "Getting started",
  "Install guides",
  "How firstrun works",
  "Reference",
] as const;

export type DocsSection = (typeof DOCS_SECTIONS)[number];

/**
 * What a section is CALLED, which is not what it IS.
 *
 * The English literal stays the identity: it is what a page writes, what the
 * sort ranks and what `sectionedTopics` groups on, and none of that may change
 * with the language. Only the label does, and it is looked up through a record
 * of literal keys rather than by building a key from the section name, because
 * `t` takes a closed union and a computed string is not in it.
 */
const SECTION_KEYS: Record<DocsSection, SimpleKey> = {
  "Getting started": "docs.section_getting_started",
  "Install guides": "docs.section_install_guides",
  "How firstrun works": "docs.section_how_it_works",
  Reference: "docs.section_reference",
};

/** Call it inside JSX, so a change of language re-renders the contents. */
export function sectionLabel(t: TFn, section: DocsSection): string {
  return t(SECTION_KEYS[section]);
}

// ---------------------------------------------------------------------------
// The values a page writes its snippets against
// ---------------------------------------------------------------------------

/**
 * A key that could not possibly be mistaken for a real one.
 *
 * Real keys are `fr_` followed by sixteen hex characters, which is
 * `SOURCE_KEY_RE` in `packages/schema/src/log.ts`. These are exactly that
 * shape with sixteen literal x's: same prefix and same length, because a reader
 * remembers the shape of what they pasted, and obviously fake in the middle,
 * because nobody should paste one and then wait for events that are never
 * coming. An earlier pair of these was twelve characters long and used a
 * segment (`app`) that was not a real one, so a reader who did paste one got a key
 * the server rejects rather than one it silently ignores.
 *
 * One placeholder for every page, because there is one key shape. It used to be
 * one per surface, so a Go page could show `fr_server_`; keys carry no such
 * segment now, and a page that invented one would be teaching a format the edge
 * rejects.
 */
export const PLACEHOLDER_KEY = "fr_xxxxxxxxxxxxxxxx";

/** Application name used before a source is picked. */
export const PLACEHOLDER_APP = "YourApp";
/** Project name used before a source is picked. */
export const PLACEHOLDER_PROJECT = "your project";

/** The substitutions a page makes into its snippets. */
export interface DocsVars {
  /** Public source key. Real when a source is picked, an obvious placeholder otherwise. */
  key: string;
  /** Absolute origin the tag and the SDK talk to. Always real, signed in or out. */
  origin: string;
  /** Application name, for SDK configuration and window titles. */
  app: string;
  /** The project the picked source belongs to. */
  project: string;
  /** True while these are placeholders -- i.e. nothing is picked. */
  placeholder: boolean;
}

export interface DocsRenderContext {
  /** The picked source. Null when signed out, or signed in with nothing picked. */
  source: DocsSource | null;
  /** Whether the reader has a session. Pages use it to offer a sign-in link. */
  signedIn: boolean;
  /** Absolute origin the tag and the SDK talk to. */
  publicOrigin: string;
  vars: DocsVars;
}

/**
 * Build the values a page substitutes.
 *
 * The placeholder key is the same on every page, because there is one key
 * shape. This used to take the page's surface and hand back a matching flavour,
 * so a Go page showed `fr_server_`; a key carries no such segment any more, and
 * a page that kept inventing one would be teaching a format the edge rejects.
 */
export function buildRenderContext(input: {
  source: DocsSource | null;
  signedIn: boolean;
  publicOrigin: string;
}): DocsRenderContext {
  const source = input.source;

  if (!source) {
    return {
      source: null,
      signedIn: input.signedIn,
      publicOrigin: input.publicOrigin,
      vars: {
        origin: input.publicOrigin,
        key: PLACEHOLDER_KEY,
        app: PLACEHOLDER_APP,
        project: PLACEHOLDER_PROJECT,
        placeholder: true,
      },
    };
  }

  // `assetName` is free text on the source and is used here for one thing: a
  // plausible application name in the SDK snippets. It is not load-bearing any
  // more (it named an installer file back when there was a download to name),
  // so a source without one falls back to the project name.
  const label = source.assetName?.trim() ?? "";
  const app = label.replace(/[-_ ]?setup$/i, "") || source.projectName || "App";

  return {
    source,
    signedIn: input.signedIn,
    publicOrigin: input.publicOrigin,
    vars: {
      key: source.ingestKey,
      origin: input.publicOrigin,
      app,
      project: source.projectName,
      placeholder: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export interface DocsTopic {
  /** URL segment: `/docs/<slug>`. Lower case, hyphens, unique across the documentation. */
  slug: string;
  title: string;
  /** One sentence, shown under the title on the index. Not a repeat of the title. */
  summary: string;
  /** Written as a literal, e.g. `"Install guides"`. See `DOCS_SECTIONS`. */
  section: DocsSection;
  /** Sort position inside the section. Lower first; unset sorts after 0-99. */
  order?: number;
  /** Optional lucide icon, imported from `lucide-solid/icons/<name>`. */
  icon?: (props: { class?: string }) => JSX.Element;
  /**
   * The page.
   *
   * Called with a snapshot of the current selection, and called **again** every
   * time the reader picks a different source -- so treat it as a pure function
   * of `ctx`. Anything that must survive a change of source belongs in a nested
   * component, not in a signal created directly inside here.
   */
  render: (ctx: DocsRenderContext) => JSX.Element;
}

/** What a `./topics/*.tsx` file has to export. */
export interface DocsTopicModule {
  topics?: DocsTopic[];
}

/**
 * Find the pages.
 *
 * Discovered rather than imported by name so that adding a page is one new
 * file: this module is the contract, and a contract that has to be edited for
 * every page is a merge conflict waiting for two people to write at once.
 * Eager, because the contents needs every title and summary before it can draw
 * itself, and the pages are text.
 */
const modules = import.meta.glob<DocsTopicModule>("./topics/*.tsx", { eager: true });

const sectionRank = (section: DocsSection) => {
  const index = DOCS_SECTIONS.indexOf(section);
  return index === -1 ? DOCS_SECTIONS.length : index;
};

function discover(): DocsTopic[] {
  const found: DocsTopic[] = [];
  const seen = new Set<string>();

  // Sorted by path so the order is the same on the server and in the browser,
  // whatever order the bundler happened to hand them over in.
  for (const path of Object.keys(modules).sort()) {
    const topics = modules[path]?.topics;
    if (!topics) continue;
    for (const topic of topics) {
      // A duplicate slug would give two pages one URL, and the loser would be
      // whichever file sorted later -- so the first wins and the second is
      // dropped rather than shadowing something silently.
      if (!topic?.slug || seen.has(topic.slug)) continue;
      seen.add(topic.slug);
      found.push(topic);
    }
  }

  return found.sort(
    (a, b) =>
      sectionRank(a.section) - sectionRank(b.section) ||
      (a.order ?? 100) - (b.order ?? 100) ||
      a.title.localeCompare(b.title)
  );
}

export const DOCS_TOPICS: DocsTopic[] = discover();

export function topicBySlug(slug: string): DocsTopic | undefined {
  return DOCS_TOPICS.find((topic) => topic.slug === slug);
}

/**
 * A page's title and summary, in the reader's language.
 *
 * These two are navigation rather than prose: they are what the contents rail,
 * the breadcrumb and the index cards are made of, and somebody deciding which
 * page to open reads them instead of the page. So they are catalogue strings,
 * keyed by slug, and they live here rather than in the topic modules because
 * those modules are documentation content and are not part of this sweep.
 *
 * A slug with no entry falls back to what its own module declares. Adding a
 * page is still one new file: it appears in English until somebody adds its two
 * keys, which is the same failure mode as a missing translation anywhere else
 * and never a broken build.
 */
const TOPIC_KEYS: Record<string, { title: SimpleKey; summary: SimpleKey }> = {
  "what-is-firstrun": {
    title: "docs.topic_what_is_firstrun_title",
    summary: "docs.topic_what_is_firstrun_summary",
  },
  workspaces: {
    title: "docs.topic_workspaces_title",
    summary: "docs.topic_workspaces_summary",
  },
  identity: { title: "docs.topic_identity_title", summary: "docs.topic_identity_summary" },
  querying: { title: "docs.topic_querying_title", summary: "docs.topic_querying_summary" },
  dashboards: { title: "docs.topic_dashboards_title", summary: "docs.topic_dashboards_summary" },
  "install-script": {
    title: "docs.topic_install_script_title",
    summary: "docs.topic_install_script_summary",
  },
  "http-api": { title: "docs.topic_http_api_title", summary: "docs.topic_http_api_summary" },
  "install-react": {
    title: "docs.topic_install_react_title",
    summary: "docs.topic_install_react_summary",
  },
  "install-nextjs": {
    title: "docs.topic_install_nextjs_title",
    summary: "docs.topic_install_nextjs_summary",
  },
  "install-sveltekit": {
    title: "docs.topic_install_sveltekit_title",
    summary: "docs.topic_install_sveltekit_summary",
  },
  "install-astro": {
    title: "docs.topic_install_astro_title",
    summary: "docs.topic_install_astro_summary",
  },
  "install-dotnet": {
    title: "docs.topic_install_dotnet_title",
    summary: "docs.topic_install_dotnet_summary",
  },
  "install-tauri": {
    title: "docs.topic_install_tauri_title",
    summary: "docs.topic_install_tauri_summary",
  },
  "install-node": {
    title: "docs.topic_install_node_title",
    summary: "docs.topic_install_node_summary",
  },
  "install-python": {
    title: "docs.topic_install_python_title",
    summary: "docs.topic_install_python_summary",
  },
  "install-go": { title: "docs.topic_install_go_title", summary: "docs.topic_install_go_summary" },
  troubleshooting: {
    title: "docs.topic_troubleshooting_title",
    summary: "docs.topic_troubleshooting_summary",
  },
  "log-entries": {
    title: "docs.topic_log_events_title",
    summary: "docs.topic_log_events_summary",
  },
  privacy: { title: "docs.topic_privacy_title", summary: "docs.topic_privacy_summary" },
};

/** Call both inside JSX: they read `t`, which is what makes them re-render. */
export function topicTitle(t: TFn, topic: DocsTopic): string {
  const keys = TOPIC_KEYS[topic.slug];
  return keys ? t(keys.title) : topic.title;
}

export function topicSummary(t: TFn, topic: DocsTopic): string {
  const keys = TOPIC_KEYS[topic.slug];
  return keys ? t(keys.summary) : topic.summary;
}

export interface DocsSectionGroup {
  section: DocsSection;
  topics: DocsTopic[];
}

/**
 * The contents: sections in order, empty ones left out.
 *
 * ## Every page, always. The selected source does not filter this.
 *
 * There used to be a `topicsForKind` in front of this that dropped any topic
 * whose `appliesTo` did not match the picked source, so choosing a desktop
 * source deleted every web install guide from the documentation and choosing a
 * web one deleted Tauri and .NET. It made the documentation a different manual
 * depending on a dropdown in the corner, and the common case -- one product, a
 * marketing site and a desktop app -- is somebody who needs BOTH guides in the
 * same afternoon.
 *
 * That filter is gone, and now so is the value it read. A source has no kind, so
 * there is nothing left to match a page against and no page can claim to be
 * written for one sort of source over another. Every guide is in the contents,
 * always, and the picked source decides the VALUES a page substitutes and
 * nothing else.
 */
export function sectionedTopics(): DocsSectionGroup[] {
  return DOCS_SECTIONS.map((section) => ({
    section,
    topics: DOCS_TOPICS.filter((topic) => topic.section === section),
  })).filter((group) => group.topics.length > 0);
}
