import type { Surface } from "@firstrun/schema";
import type { JSX } from "solid-js";
import type { WikiSource } from "../../lib/api.js";
import type { SimpleKey, TFn } from "../../lib/i18n/index.js";

/**
 * Every page in the wiki, in one list.
 *
 * Pages are Solid components rather than markdown, and that is the whole
 * design: a snippet has to arrive carrying the reader's own ingest key, and a
 * markdown runtime can only ever hand back a string somebody has to edit before
 * pasting. A plain TypeScript registry also means the table of contents, the
 * per-kind filtering and the not-found page all read from the same array
 * instead of three lists that drift.
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
 * `WikiSection` is a union of these four strings rather than a free string, so
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
 * a binding that is still in its temporal dead zone -- and the whole wiki dies
 * with a `Cannot access '...' before initialization` that names nothing useful.
 * Types are erased and cost nothing, so a page imports types from here and
 * spells section names as literals. Do not add a constant back.
 */
export const WIKI_SECTIONS = [
  "Getting started",
  "Install guides",
  "How firstrun works",
  "Reference",
] as const;

export type WikiSection = (typeof WIKI_SECTIONS)[number];

/**
 * What a section is CALLED, which is not what it IS.
 *
 * The English literal stays the identity: it is what a page writes, what the
 * sort ranks and what `sectionedTopics` groups on, and none of that may change
 * with the language. Only the label does, and it is looked up through a record
 * of literal keys rather than by building a key from the section name, because
 * `t` takes a closed union and a computed string is not in it.
 */
const SECTION_KEYS: Record<WikiSection, SimpleKey> = {
  "Getting started": "wiki.section_getting_started",
  "Install guides": "wiki.section_install_guides",
  "How firstrun works": "wiki.section_how_it_works",
  Reference: "wiki.section_reference",
};

/** Call it inside JSX, so a change of language re-renders the contents. */
export function sectionLabel(t: TFn, section: WikiSection): string {
  return t(SECTION_KEYS[section]);
}

// ---------------------------------------------------------------------------
// The values a page writes its snippets against
// ---------------------------------------------------------------------------

/**
 * A key that could not possibly be mistaken for a real one.
 *
 * Real keys are `fr_<surface>_` followed by sixteen characters, which is
 * `SOURCE_KEY_RE` in `packages/schema/src/log.ts`. These are exactly that
 * shape with sixteen literal x's: same prefix and same length, because a reader
 * remembers the shape of what they pasted, and obviously fake in the middle,
 * because nobody should paste one and then wait for events that are never
 * coming. An earlier pair of these was twelve characters long and used a
 * surface (`app`) that does not exist, so a reader who did paste one got a key
 * the server rejects rather than one it silently ignores.
 *
 * One per surface rather than one for the whole wiki: a page about a Go server
 * showing `fr_web_` teaches the wrong prefix while it is teaching the right
 * call.
 */
export const PLACEHOLDER_KEYS: Record<Surface, string> = {
  web: "fr_web_xxxxxxxxxxxxxxxx",
  desktop: "fr_desktop_xxxxxxxxxxxxxxxx",
  mobile: "fr_mobile_xxxxxxxxxxxxxxxx",
  server: "fr_server_xxxxxxxxxxxxxxxx",
  other: "fr_other_xxxxxxxxxxxxxxxx",
};

/** The key a page gets when nothing is picked and it named no surface. */
export const PLACEHOLDER_WEB_KEY = PLACEHOLDER_KEYS.web;
/** Application name used before a source is picked. */
export const PLACEHOLDER_APP = "YourApp";
/** Project name used before a source is picked. */
export const PLACEHOLDER_PROJECT = "your project";

/** The substitutions a page makes into its snippets. */
export interface WikiVars {
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

export interface WikiRenderContext {
  /** The picked source. Null when signed out, or signed in with nothing picked. */
  source: WikiSource | null;
  /** Whether the reader has a session. Pages use it to offer a sign-in link. */
  signedIn: boolean;
  /** Absolute origin the tag and the SDK talk to. */
  publicOrigin: string;
  vars: WikiVars;
}

/**
 * Build the values a page substitutes.
 *
 * `kind` decides which flavour of placeholder key is shown when nothing is
 * picked -- a desktop page should never show a `fr_web_` key, even a fake one,
 * because the reader will remember the shape rather than the value. It takes
 * the whole `Surface`, not the two surfaces we happened to write pages for
 * first, so a server page can ask for a `fr_server_` placeholder.
 */
export function buildRenderContext(input: {
  source: WikiSource | null;
  signedIn: boolean;
  publicOrigin: string;
  kind?: Surface;
}): WikiRenderContext {
  const source = input.source;

  if (!source) {
    return {
      source: null,
      signedIn: input.signedIn,
      publicOrigin: input.publicOrigin,
      vars: {
        key: (input.kind && PLACEHOLDER_KEYS[input.kind]) || PLACEHOLDER_WEB_KEY,
        origin: input.publicOrigin,
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

export interface WikiTopic {
  /** URL segment: `/wiki/<slug>`. Lower case, hyphens, unique across the wiki. */
  slug: string;
  title: string;
  /** One sentence, shown under the title on the index. Not a repeat of the title. */
  summary: string;
  /** Written as a literal, e.g. `"Install guides"`. See `WIKI_SECTIONS`. */
  section: WikiSection;
  /**
   * Only meaningful for one kind of source.
   *
   * A topic marked `desktop` is hidden from the contents while the reader has a
   * web source picked, and the other way round. Omit it for anything that
   * applies to every surface, which is most pages.
   *
   * The whole `Surface`, not a pair. While this was `"web" | "desktop"` a
   * reader with a server source picked was filtered down to no install pages
   * at all, because a server install page had no honest value to claim.
   */
  appliesTo?: Surface;
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
  render: (ctx: WikiRenderContext) => JSX.Element;
}

/** What a `./topics/*.tsx` file has to export. */
export interface WikiTopicModule {
  topics?: WikiTopic[];
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
const modules = import.meta.glob<WikiTopicModule>("./topics/*.tsx", { eager: true });

const sectionRank = (section: WikiSection) => {
  const index = WIKI_SECTIONS.indexOf(section);
  return index === -1 ? WIKI_SECTIONS.length : index;
};

function discover(): WikiTopic[] {
  const found: WikiTopic[] = [];
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

export const WIKI_TOPICS: WikiTopic[] = discover();

export function topicBySlug(slug: string): WikiTopic | undefined {
  return WIKI_TOPICS.find((topic) => topic.slug === slug);
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
    title: "wiki.topic_what_is_firstrun_title",
    summary: "wiki.topic_what_is_firstrun_summary",
  },
  workspaces: {
    title: "wiki.topic_workspaces_title",
    summary: "wiki.topic_workspaces_summary",
  },
  identity: { title: "wiki.topic_identity_title", summary: "wiki.topic_identity_summary" },
  querying: { title: "wiki.topic_querying_title", summary: "wiki.topic_querying_summary" },
  dashboards: { title: "wiki.topic_dashboards_title", summary: "wiki.topic_dashboards_summary" },
  "install-script": {
    title: "wiki.topic_install_script_title",
    summary: "wiki.topic_install_script_summary",
  },
  "install-react": {
    title: "wiki.topic_install_react_title",
    summary: "wiki.topic_install_react_summary",
  },
  "install-nextjs": {
    title: "wiki.topic_install_nextjs_title",
    summary: "wiki.topic_install_nextjs_summary",
  },
  "install-sveltekit": {
    title: "wiki.topic_install_sveltekit_title",
    summary: "wiki.topic_install_sveltekit_summary",
  },
  "install-astro": {
    title: "wiki.topic_install_astro_title",
    summary: "wiki.topic_install_astro_summary",
  },
  "install-dotnet": {
    title: "wiki.topic_install_dotnet_title",
    summary: "wiki.topic_install_dotnet_summary",
  },
  "install-tauri": {
    title: "wiki.topic_install_tauri_title",
    summary: "wiki.topic_install_tauri_summary",
  },
  "install-node": {
    title: "wiki.topic_install_node_title",
    summary: "wiki.topic_install_node_summary",
  },
  "install-python": {
    title: "wiki.topic_install_python_title",
    summary: "wiki.topic_install_python_summary",
  },
  "install-go": { title: "wiki.topic_install_go_title", summary: "wiki.topic_install_go_summary" },
  troubleshooting: {
    title: "wiki.topic_troubleshooting_title",
    summary: "wiki.topic_troubleshooting_summary",
  },
  "log-entries": {
    title: "wiki.topic_log_entries_title",
    summary: "wiki.topic_log_entries_summary",
  },
  privacy: { title: "wiki.topic_privacy_title", summary: "wiki.topic_privacy_summary" },
};

/** Call both inside JSX: they read `t`, which is what makes them re-render. */
export function topicTitle(t: TFn, topic: WikiTopic): string {
  const keys = TOPIC_KEYS[topic.slug];
  return keys ? t(keys.title) : topic.title;
}

export function topicSummary(t: TFn, topic: WikiTopic): string {
  const keys = TOPIC_KEYS[topic.slug];
  return keys ? t(keys.summary) : topic.summary;
}

export interface WikiSectionGroup {
  section: WikiSection;
  topics: WikiTopic[];
}

/**
 * The contents: sections in order, empty ones left out.
 *
 * ## Every page, always. The selected source does not filter this.
 *
 * There used to be a `topicsForKind` in front of this that dropped any topic
 * whose `appliesTo` did not match the picked source, so choosing a desktop
 * source deleted every web install guide from the wiki and choosing a web one
 * deleted Tauri and .NET. The argument was that a Tauri page is noise while you
 * are installing a website tag.
 *
 * It is the wrong trade, and it made the wiki a different manual depending on a
 * dropdown in the corner. A reader who picks a source has said which key they
 * want pasted into the snippets. They have not said which of a customer's four
 * surfaces they will never ship, and the common case -- one product, a
 * marketing site and a desktop app -- is somebody who needs BOTH guides in the
 * same afternoon. A page that vanishes cannot be found again by someone who
 * does not know a dropdown three feet away is why it went, and a link to it
 * from outside opens a page the contents claims does not exist.
 *
 * So the source affects the VALUES a page substitutes and nothing else.
 * `appliesTo` is still real: it decides which placeholder key flavour a page
 * shows, and it is what lets a page say out loud that it is written for a
 * different kind of source than the one currently picked. Neither of those
 * hides anything.
 */
export function sectionedTopics(): WikiSectionGroup[] {
  return WIKI_SECTIONS.map((section) => ({
    section,
    topics: WIKI_TOPICS.filter((topic) => topic.section === section),
  })).filter((group) => group.topics.length > 0);
}
