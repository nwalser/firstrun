import { describe, expect, test } from "bun:test";
import { IdentityResolver, MemoryIdentityStore, canonicalOf, seedPersonId } from "../src/index.js";
import type { Distinct } from "../src/index.js";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";

const web = (id: string): Distinct => ({ type: "web_visitor", id });
const install = (id: string): Distinct => ({ type: "install", id });
const account = (id: string): Distinct => ({ type: "account", id });

function fresh() {
  const store = new MemoryIdentityStore();
  return { store, resolver: new IdentityResolver(store) };
}

describe("seed persons", () => {
  test("a distinct nobody has joined still has a stable person", async () => {
    const { resolver } = fresh();
    const a = await resolver.resolve(WORKSPACE, web("v1"));
    const b = await resolver.resolve(WORKSPACE, web("v1"));
    expect(a).toBe(b);
    expect(a).toBe(seedPersonId(WORKSPACE, web("v1")));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("the same distinct id in two workspaces is two people", async () => {
    const { resolver } = fresh();
    expect(await resolver.resolve(WORKSPACE, web("v1"))).not.toBe(
      await resolver.resolve(OTHER_WORKSPACE, web("v1"))
    );
  });

  test("a web visitor and an install that share an id string are still two people", async () => {
    const { resolver } = fresh();
    expect(await resolver.resolve(WORKSPACE, web("x"))).not.toBe(
      await resolver.resolve(WORKSPACE, install("x"))
    );
  });
});

describe("token join", () => {
  test("claiming a token makes the visitor and the install one person", async () => {
    const { resolver } = fresh();
    const before = await resolver.resolve(WORKSPACE, install("i1"));
    const result = await resolver.link(WORKSPACE, install("i1"), web("v1"), "token");

    expect(result.person_id).not.toBeNull();
    expect(await resolver.resolve(WORKSPACE, install("i1"))).toBe(result.person_id!);
    expect(await resolver.resolve(WORKSPACE, web("v1"))).toBe(result.person_id!);

    const expected = canonicalOf([
      seedPersonId(WORKSPACE, install("i1")),
      seedPersonId(WORKSPACE, web("v1")),
    ]);
    expect(result.person_id).toBe(expected);
    // At least one of the two had to move, since only one seed can be lowest.
    expect(result.moved.length).toBeGreaterThan(0);
    expect(before === result.person_id || result.moved.some((m) => m.type === "install")).toBe(true);
  });

  test("lowest uuid wins, not first seen", async () => {
    const { resolver } = fresh();
    await resolver.link(WORKSPACE, install("i2"), web("v2"), "token");
    const person = await resolver.resolve(WORKSPACE, install("i2"));
    const seeds = [seedPersonId(WORKSPACE, install("i2")), seedPersonId(WORKSPACE, web("v2"))];
    expect(person).toBe(canonicalOf(seeds));
    expect(person).toBe([...seeds].sort()[0]!);
  });

  test("the same edges in the opposite order land on the same person", async () => {
    const forward = fresh();
    await forward.resolver.link(WORKSPACE, web("v3"), install("i3"), "token");
    await forward.resolver.link(WORKSPACE, install("i3"), account("acct-3"), "account");

    const backward = fresh();
    await backward.resolver.link(WORKSPACE, install("i3"), account("acct-3"), "account");
    await backward.resolver.link(WORKSPACE, web("v3"), install("i3"), "token");

    expect(await forward.resolver.resolve(WORKSPACE, web("v3"))).toBe(
      await backward.resolver.resolve(WORKSPACE, web("v3"))
    );
  });

  test("joins are transitive across three distincts", async () => {
    const { resolver } = fresh();
    await resolver.link(WORKSPACE, web("v4"), install("i4"), "token");
    await resolver.link(WORKSPACE, install("i4"), account("acct-4"), "account");

    const p = await resolver.resolve(WORKSPACE, web("v4"));
    expect(await resolver.resolve(WORKSPACE, install("i4"))).toBe(p);
    expect(await resolver.resolve(WORKSPACE, account("acct-4"))).toBe(p);
  });

  test("two separate people stay separate", async () => {
    const { resolver } = fresh();
    await resolver.link(WORKSPACE, web("v5"), install("i5"), "token");
    await resolver.link(WORKSPACE, web("v6"), install("i6"), "token");
    expect(await resolver.resolve(WORKSPACE, web("v5"))).not.toBe(
      await resolver.resolve(WORKSPACE, web("v6"))
    );
  });

  test("merging two already-merged components keeps everyone together", async () => {
    const { resolver } = fresh();
    await resolver.link(WORKSPACE, web("a1"), install("a2"), "token");
    await resolver.link(WORKSPACE, web("b1"), install("b2"), "token");
    // The user logs in on both surfaces under one account.
    await resolver.link(WORKSPACE, install("a2"), account("same"), "account");
    await resolver.link(WORKSPACE, install("b2"), account("same"), "account");

    const ids = await Promise.all(
      [web("a1"), install("a2"), web("b1"), install("b2"), account("same")].map((d) =>
        resolver.resolve(WORKSPACE, d)
      )
    );
    expect(new Set(ids).size).toBe(1);
  });
});

describe("overrides", () => {
  test("an exact link writes overrides immediately, before any squash", async () => {
    const { store, resolver } = fresh();
    const result = await resolver.link(WORKSPACE, install("i7"), web("v7"), "token");
    const pending = await store.pendingOverrides();

    expect(pending.length).toBe(result.moved.length);
    for (const row of pending) expect(row.person_id).toBe(result.person_id!);
  });

  test("re-linking an edge that changes nothing writes no new override", async () => {
    const { store, resolver } = fresh();
    await resolver.link(WORKSPACE, install("i8"), web("v8"), "token");
    const first = (await store.pendingOverrides()).length;
    await resolver.link(WORKSPACE, install("i8"), web("v8"), "token");
    expect((await store.pendingOverrides()).length).toBe(first);
  });
});

describe("observe", () => {
  test("an account id seen next to an install joins them without a separate call", async () => {
    const { resolver } = fresh();
    const p1 = await resolver.observe({
      workspace_id: WORKSPACE,
      install_id: "i9",
      account_id: "acct-9",
    });
    const p2 = await resolver.observe({ workspace_id: WORKSPACE, web_visitor_id: "v9", account_id: "acct-9" });
    expect(p1).toBe(p2);
  });

  test("observe does not invent an edge on every event", async () => {
    const { store, resolver } = fresh();
    for (let i = 0; i < 5; i++) {
      await resolver.observe({ workspace_id: WORKSPACE, install_id: "i10", account_id: "acct-10" });
    }
    expect(store.edges.length).toBe(1);
  });

  test("an event with no distinct at all is a programming error, not a person", async () => {
    const { resolver } = fresh();
    await expect(resolver.observe({ workspace_id: WORKSPACE })).rejects.toThrow(/at least one distinct/);
  });
});

describe("confidence guards", () => {
  test("an exact edge cannot claim less than full confidence", async () => {
    const { resolver } = fresh();
    await expect(resolver.link(WORKSPACE, install("i11"), web("v11"), "token", 0.9)).rejects.toThrow(
      /confidence 1/
    );
  });

  test("an estimate edge cannot claim full confidence", async () => {
    const { resolver } = fresh();
    await expect(
      resolver.link(WORKSPACE, install("i12"), web("v12"), "estimate", 1)
    ).rejects.toThrow(/below 1/);
  });
});
