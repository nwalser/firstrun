import { z } from "zod";

/**
 * The kinds of thing that can send us a log entry.
 *
 * This is not a property of an entry. It is a property of the SOURCE the entry
 * arrived through, recorded on the source row and stamped onto the entry as an
 * attribute by the edge. A client cannot claim to be a different surface than
 * the key it used.
 *
 * `other` exists so a customer with a CLI, a game console or a fridge has a
 * value to send rather than a reason to lie about being a server.
 */
export const SURFACES = ["web", "desktop", "mobile", "server", "other"] as const;

export const Surface = z.enum(SURFACES);
export type Surface = z.infer<typeof Surface>;

export const SURFACE_LABELS: Record<Surface, string> = {
  web: "Web",
  desktop: "Desktop",
  mobile: "Mobile",
  server: "Server",
  other: "Other",
};

/** Every surface, for a picker that is not scoped to one source. */
export const ALL_SURFACES: readonly Surface[] = SURFACES;
