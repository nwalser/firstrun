/**
 * Types for the two highlight.js subpaths we import.
 *
 * The package ships `types/index.d.ts` and points its root export at it, but
 * its `exports` map has no `types` condition for `./lib/core` or
 * `./lib/languages/*`. Under `moduleResolution: "bundler"` those subpaths
 * therefore resolve to plain JavaScript with no declarations, and every import
 * of one is an implicit `any` under `strict`.
 *
 * Importing the root instead would type-check, and would also pull all 190-odd
 * grammars into the bundle. So the subpaths stay, and their shapes are stated
 * here against the package's own published types.
 */
declare module "highlight.js/lib/core" {
  import type { HLJSApi } from "highlight.js";
  const hljs: HLJSApi;
  export default hljs;
}

declare module "highlight.js/lib/languages/*" {
  import type { LanguageFn } from "highlight.js";
  const language: LanguageFn;
  export default language;
}
