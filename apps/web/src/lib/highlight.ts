import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import csharp from "highlight.js/lib/languages/csharp";
import go from "highlight.js/lib/languages/go";
import ini from "highlight.js/lib/languages/ini";
import javascript from "highlight.js/lib/languages/javascript";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

/**
 * Syntax highlighting for the wiki's snippets.
 *
 * ## Why highlight.js, and why the core build
 *
 * Shiki produces better output, and its smallest useful bundle is several
 * hundred kilobytes of grammars plus an oniguruma WASM binary. That is a lot of
 * weight to add to a self-hosted analytics dashboard so that its install guides
 * look nicer. highlight.js has no WASM step, and its `lib/core` entry ships the
 * engine with no grammars at all: every language below is here because a wiki
 * page asks for it, and the eight or nine that are not listed are not in the
 * bundle.
 *
 * ## It runs during render, on the server
 *
 * `highlight()` is a synchronous pure function, so it is called in the same
 * pass that builds the markup. The wiki is server-rendered and public, and a
 * highlighter that only wakes up after hydration gives every reader a flash of
 * plain code followed by a repaint -- and, because the two renders disagree
 * about the contents of the block, a hydration mismatch as well. Same input,
 * same output, on both sides: nothing to reconcile.
 *
 * That is also the reason this module is imported from the wiki's `Snippet`
 * rather than from `CodeBlock`. `CodeBlock` is shared with the dashboard, and a
 * static import there would put the highlighter in a chunk the dashboard loads
 * to render a source key. A dynamic import would split it, but a dynamic import
 * is async, and async is exactly what the paragraph above rules out.
 *
 * ## The output is HTML, and the input is ours
 *
 * `highlight()` returns markup, and the caller sets it as HTML. That is safe
 * here for one specific reason: every string that reaches it is a snippet
 * authored in this repository, plus substituted values from the reader's own
 * source (a key, a host, a project name). highlight.js escapes `&`, `<` and `>`
 * in the code it is given, so even those substituted values cannot open a tag.
 *
 * What would make it unsafe is the input becoming something a stranger wrote:
 * a snippet loaded from the database, from a URL parameter, or from a
 * customer's own event properties. If that ever happens, this function is no
 * longer allowed to reach `innerHTML`, and the block has to render text.
 */

/**
 * The grammars, keyed by the name they register under.
 *
 * Their own alias lists come with them, which covers most of what the wiki
 * writes: `ts` and `tsx` reach typescript, `js` reaches javascript, `html`
 * reaches xml, `toml` reaches ini, `cs` reaches csharp, `sh` reaches bash.
 */
const GRAMMARS = {
  bash,
  csharp,
  go,
  ini,
  javascript,
  python,
  rust,
  typescript,
  xml,
} as const;

for (const [name, grammar] of Object.entries(GRAMMARS)) {
  hljs.registerLanguage(name, grammar);
}

/**
 * Two component formats highlight.js has no grammar for.
 *
 * Both are markup with a script block in them, which is what `xml` already
 * models: it highlights the tags and hands the contents of a `<script>` to the
 * javascript sub-language. Astro's `---` frontmatter fence renders as plain
 * text inside it, which is the honest result and not a wrong one.
 */
hljs.registerAliases(["svelte", "astro"], { languageName: "xml" });

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(code: string): string {
  return code.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Whether a language name has a grammar or an alias registered above. */
export function canHighlight(language: string | undefined): boolean {
  return !!language && !!hljs.getLanguage(language);
}

/**
 * The snippet as HTML, highlighted if we know the language and escaped if we
 * do not.
 *
 * Always returns markup, never null, so the block has one shape to render and
 * the server and the client cannot pick different branches of it.
 *
 * An unknown language is not an error: a page is allowed to pass a name we have
 * no grammar for, or none at all, and gets plain escaped code back. Whitespace
 * is untouched in both paths -- highlight.js wraps runs of text in spans and
 * never re-indents, and the block preserves it because it is a `pre`.
 */
export function highlight(code: string, language?: string): string {
  if (!canHighlight(language)) return escapeHtml(code);
  try {
    // `ignoreIllegals` because a snippet is a fragment: a page shows the three
    // lines that matter, and a grammar's illegal-sequence rule will happily
    // reject a valid file cut in half. Falling back to plain text there would
    // mean the shortest snippets are the ones that lose their colour.
    return hljs.highlight(code, { language: language as string, ignoreIllegals: true }).value;
  } catch {
    // A grammar that throws is a bug in the grammar, not a reason to lose the
    // snippet. The reader still gets the code, and can still copy it.
    return escapeHtml(code);
  }
}
