import { describe, expect, test } from "bun:test";
import {
  IdentityResolver,
  MemoryIdentityStore,
  seedPersonId,
  squash,
} from "../src/index.js";
import type { Distinct } from "../src/index.js";

/**
 * CLAUDE.md rule 1.
 *
 * Estimated joins are a guess about two rows in a database. Exact joins are a
 * fact about a human being. If a guess is ever allowed to rewrite a person id,
 * the product's one differentiating number quietly becomes a number nobody can
 * trust, and nothing downstream will notice.
 *
 * This file is the tripwire. It is allowed to get stricter. It is not allowed
 * to get weaker.
 */

const WORKSPACE = "33333333-3333-4333-8333-333333333333";
const web = (id: string): Distinct => ({ type: "web_visitor", id });
const install = (id: string): Distinct => ({ type: "install", id });

function fresh() {
  const store = new MemoryIdentityStore();
  return { store, resolver: new IdentityResolver(store) };
}

describe("an estimate edge never mutates a person id", () => {
  test("resolve is unchanged on both sides of the edge", async () => {
    const { resolver } = fresh();
    const beforeInstall = await resolver.resolve(WORKSPACE, install("i1"));
    const beforeWeb = await resolver.resolve(WORKSPACE, web("v1"));

    await resolver.link(WORKSPACE, install("i1"), web("v1"), "estimate", 0.7);

    expect(await resolver.resolve(WORKSPACE, install("i1"))).toBe(beforeInstall);
    expect(await resolver.resolve(WORKSPACE, web("v1"))).toBe(beforeWeb);
    expect(beforeInstall).not.toBe(beforeWeb);
  });

  test("the two sides stay two separate people", async () => {
    const { resolver } = fresh();
    await resolver.link(WORKSPACE, install("i2"), web("v2"), "estimate", 0.7);
    expect(await resolver.resolve(WORKSPACE, install("i2"))).toBe(seedPersonId(WORKSPACE, install("i2")));
    expect(await resolver.resolve(WORKSPACE, web("v2"))).toBe(seedPersonId(WORKSPACE, web("v2")));
  });

  test("link() refuses to hand back a person for an estimate", async () => {
    const { resolver } = fresh();
    const result = await resolver.link(WORKSPACE, install("i3"), web("v3"), "estimate", 0.42);
    expect(result.person_id).toBeNull();
    expect(result.moved).toEqual([]);
  });

  test("no override row is written", async () => {
    const { store, resolver } = fresh();
    await resolver.link(WORKSPACE, install("i4"), web("v4"), "estimate", 0.7);
    expect(await store.pendingOverrides()).toEqual([]);
  });

  test("squash rewrites nothing, so stored events keep their person", async () => {
    const { store, resolver } = fresh();
    const installPerson = await resolver.resolve(WORKSPACE, install("i5"));
    const webPerson = await resolver.resolve(WORKSPACE, web("v5"));

    store.events.push(
      {
        workspace_id: WORKSPACE,
        event_id: "e1",
        person_id: installPerson,
        web_visitor_id: null,
        install_id: "i5",
        account_id: null,
      },
      {
        workspace_id: WORKSPACE,
        event_id: "e2",
        person_id: webPerson,
        web_visitor_id: "v5",
        install_id: null,
        account_id: null,
      }
    );

    await resolver.link(WORKSPACE, install("i5"), web("v5"), "estimate", 0.9);
    const report = await squash(store);

    expect(report.eventsRewritten).toBe(0);
    expect(store.events[0]!.person_id).toBe(installPerson);
    expect(store.events[1]!.person_id).toBe(webPerson);
  });

  test("an estimate cannot bridge two components that an exact edge would", async () => {
    const { resolver } = fresh();
    // Exact chain on the left, exact chain on the right, estimate between them.
    await resolver.link(WORKSPACE, web("L1"), install("L2"), "token");
    await resolver.link(WORKSPACE, web("R1"), install("R2"), "token");
    await resolver.link(WORKSPACE, install("L2"), install("R2"), "estimate", 0.8);

    const left = await resolver.resolve(WORKSPACE, web("L1"));
    const right = await resolver.resolve(WORKSPACE, web("R1"));
    expect(left).not.toBe(right);
    expect(await resolver.resolve(WORKSPACE, install("L2"))).toBe(left);
    expect(await resolver.resolve(WORKSPACE, install("R2"))).toBe(right);
  });

  test("an estimate does not survive as a shortcut once an exact edge arrives elsewhere", async () => {
    const { resolver } = fresh();
    await resolver.link(WORKSPACE, install("i6"), web("v6"), "estimate", 0.8);
    await resolver.link(WORKSPACE, install("i6"), web("v7"), "token");

    const person = await resolver.resolve(WORKSPACE, install("i6"));
    expect(await resolver.resolve(WORKSPACE, web("v7"))).toBe(person);
    // v6 was only ever a guess. It stays out.
    expect(await resolver.resolve(WORKSPACE, web("v6"))).not.toBe(person);
  });

  test("the store never returns an estimate edge to traversal", async () => {
    const { store, resolver } = fresh();
    await resolver.link(WORKSPACE, install("i7"), web("v8"), "estimate", 0.6);
    const edges = await store.exactEdgesTouching(WORKSPACE, [install("i7"), web("v8")]);
    expect(edges).toEqual([]);
    // ...but the edge was still recorded, because the funnel reports it separately.
    expect(store.edges.filter((e) => e.method === "estimate").length).toBe(1);
  });
});
