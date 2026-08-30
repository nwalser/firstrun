import { z } from "zod";

/**
 * Attributes: everything about a log entry that is not one of the five promoted
 * columns.
 *
 * The backend does not know what any of these mean. `os.type` is not a feature,
 * it is a key a client happened to send, and the only reason the product can do
 * anything with it is that the query layer can reach into JSON by path. That is
 * deliberate: a closed set of columns is a closed set of questions, and the one
 * thing we cannot know in advance is which question a customer needs answered.
 *
 * What IS closed is the shape: a string-keyed map of JSON, bounded in count,
 * depth, key length and string length. Bounds exist because this is written by
 * anyone who has a source key, and an unbounded nested document is a way to
 * make the ingest path do unbounded work.
 */

export type AttributeValue =
  | string
  | number
  | boolean
  | null
  | AttributeValue[]
  | { [key: string]: AttributeValue };

/** How many top-level keys one entry may carry. */
export const MAX_ATTRIBUTES = 64;
/** How deep the JSON may nest. The top-level map counts as level one. */
export const MAX_ATTRIBUTE_DEPTH = 4;
export const MAX_ATTRIBUTE_KEY = 128;
export const MAX_ATTRIBUTE_STRING = 4096;
/** How many entries one array or nested object may hold. */
export const MAX_ATTRIBUTE_ITEMS = 128;

export const AttributeKey = z.string().min(1).max(MAX_ATTRIBUTE_KEY);

const Leaf = z.union([
  z.string().max(MAX_ATTRIBUTE_STRING),
  // Finite because NaN and Infinity are not JSON and would land in the column
  // as the string "null" after a round trip through the driver.
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/**
 * Depth is bounded by BUILDING a different schema per level rather than by
 * `z.lazy`, so the limit is structural. A lazy schema with a runtime counter
 * would still have to walk the whole document before deciding to reject it.
 */
function valueAtDepth(depth: number): z.ZodType<AttributeValue> {
  if (depth <= 1) return Leaf;
  const inner = valueAtDepth(depth - 1);
  return z.union([
    Leaf,
    z.array(inner).max(MAX_ATTRIBUTE_ITEMS),
    z.record(AttributeKey, inner),
  ]) as z.ZodType<AttributeValue>;
}

export const AttributeValue: z.ZodType<AttributeValue> = valueAtDepth(MAX_ATTRIBUTE_DEPTH);

export const Attributes = z
  .record(AttributeKey, AttributeValue)
  .refine((o) => Object.keys(o).length <= MAX_ATTRIBUTES, {
    message: `at most ${MAX_ATTRIBUTES} attributes`,
  });

export type Attributes = Record<string, AttributeValue>;

// ---------------------------------------------------------------------------
// Attribute paths
// ---------------------------------------------------------------------------

/**
 * A path into the attribute map, as an array of segments.
 *
 * The first segment is a top-level key and may itself contain dots, because the
 * OTel semantic conventions are flat dotted keys: `exception.type` is ONE key,
 * not an object called `exception`. Further segments index into nested JSON or
 * into an array by numeric string.
 *
 *   `["exception.type"]`            the conventional flat key
 *   `["http", "headers", "accept"]` three levels of a nested object
 *   `["items", "0", "sku"]`         through an array
 *
 * ## Why this is safe
 *
 * A path is DATA and never reaches SQL as text. The query compiler binds it as
 * a single `text[]` parameter and lets Postgres do the walk:
 *
 *   `attributes #>> $1::text[]`   with $1 = the segment array
 *
 * There is no place in that expression for a segment to become syntax, so even
 * a segment consisting entirely of quotes and semicolons is looked up as a key
 * that does not exist and yields null. `ATTR_SEGMENT_RE` is therefore belt and
 * braces rather than the defence itself: it exists so a path that could only
 * have come from a mistake or an attack is rejected at the edge of the system
 * with a clear error, instead of quietly matching nothing three layers down.
 * Any future compiler that builds an expression by concatenation instead of by
 * binding has broken this guarantee, and no regex will put it back.
 */
export const ATTR_SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

export const AttrSegment = z.string().regex(ATTR_SEGMENT_RE, "invalid attribute path segment");

export const MAX_ATTR_PATH = 8;

export const AttrPath = z.array(AttrSegment).min(1).max(MAX_ATTR_PATH);

export type AttrPath = string[];

export const isAttrSegment = (s: string): boolean => ATTR_SEGMENT_RE.test(s);

export const isAttrPath = (p: readonly string[]): boolean => AttrPath.safeParse(p).success;

/** How a path reads in a header or a chip. Display only, never an identity. */
export const attrPathLabel = (p: readonly string[]): string => p.join(".");
