import { createHash } from "node:crypto";
import type { Distinct } from "./types.js";

/**
 * A `person_id` is derived, never sent. See CLAUDE.md rule 3.
 *
 * Every distinct has a *seed* person: a UUIDv5 of `<project>:<type>:<id>`.
 * Deterministic, so a visitor who has never been joined to anything still has a
 * stable person id, and so two processes computing the same thing agree without
 * needing a sequence or a round trip.
 *
 * When exact edges merge several distincts into one component, the canonical
 * person for that component is the LOWEST of the member seed ids. Lowest rather
 * than first-seen so the outcome does not depend on arrival order: replaying the
 * same edges in any order lands on the same person.
 */

/** Fixed namespace for this product. Changing it re-persons the whole database. */
const NAMESPACE = "0f1a5b6e-7c8d-4e9f-a0b1-c2d3e4f50617";

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return (
    h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32)
  );
}

export function uuidv5(name: string, namespace: string = NAMESPACE): string {
  const ns = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const buf = new Uint8Array(ns.length + nameBytes.length);
  buf.set(ns, 0);
  buf.set(nameBytes, ns.length);

  const digest = createHash("sha1").update(buf).digest();
  const out = new Uint8Array(digest.subarray(0, 16));
  out[6] = (out[6]! & 0x0f) | 0x50; // version 5
  out[8] = (out[8]! & 0x3f) | 0x80; // RFC 4122 variant
  return bytesToUuid(out);
}

/** The person a distinct belongs to before anything is known about it. */
export function seedPersonId(projectId: string, d: Distinct): string {
  return uuidv5(projectId + ":" + d.type + ":" + d.id);
}

/** Lowest UUID wins. Order-independent by construction. */
export function canonicalOf(personIds: readonly string[]): string {
  if (personIds.length === 0) throw new Error("canonicalOf needs at least one person id");
  let lowest = personIds[0]!;
  for (const p of personIds) if (p < lowest) lowest = p;
  return lowest;
}
