/**
 * What makes a namespace file safe to own alone.
 *
 * Every module in this folder holds the strings of exactly one area, and every
 * key in it starts with that area's name. `satisfies Namespaced<"sources">` is
 * what enforces the second half: a key put in the wrong file, or a namespace
 * misspelled at the top of a new block, is a compile error in that file rather
 * than a silent duplicate that the composition in `en.ts` resolves by last
 * spread wins.
 *
 * That property is the whole reason the catalogue is split. Because two
 * namespaces can never contain the same key, two people editing two namespace
 * files can never disagree about a string, and the composed catalogue is the
 * union of their work with nothing to merge.
 *
 * `satisfies` rather than an annotation, so `typeof` on the object stays the
 * exact set of keys. An annotation would flatten it to the index signature and
 * take the key union, which is the compile-time safety, with it.
 */
export type Namespaced<N extends string> = Record<`${N}.${string}`, string>;
