import { describe, expect, test } from "bun:test";
import { IdentityResolver, MemoryIdentityStore, squash } from "../src/index.js";

const WORKSPACE = "44444444-4444-4444-8444-444444444444";

function fresh() {
  const store = new MemoryIdentityStore();
  return { store, resolver: new IdentityResolver(store) };
}

describe("squash", () => {
  test("drains overrides into events and deletes what it drained", async () => {
    const { store, resolver } = fresh();

    const webPerson = await resolver.resolve(WORKSPACE, { type: "web_visitor", id: "v1" });
    const installPerson = await resolver.resolve(WORKSPACE, { type: "install", id: "i1" });

    store.events.push(
      {
        workspace_id: WORKSPACE,
        event_id: "e1",
        person_id: webPerson,
        web_visitor_id: "v1",
        install_id: null,
        account_id: null,
      },
      {
        workspace_id: WORKSPACE,
        event_id: "e2",
        person_id: installPerson,
        web_visitor_id: null,
        install_id: "i1",
        account_id: null,
      }
    );

    const link = await resolver.link(
      WORKSPACE,
      { type: "install", id: "i1" },
      { type: "web_visitor", id: "v1" },
      "token"
    );

    const report = await squash(store);

    expect(report.overridesDrained).toBeGreaterThan(0);
    expect(report.eventsRewritten).toBeGreaterThan(0);
    expect(await store.pendingOverrides()).toEqual([]);
    expect(new Set(store.events.map((e) => e.person_id))).toEqual(new Set([link.person_id!]));
  });

  test("running twice is a no-op the second time", async () => {
    const { store, resolver } = fresh();
    store.events.push({
      workspace_id: WORKSPACE,
      event_id: "e1",
      person_id: await resolver.resolve(WORKSPACE, { type: "install", id: "i2" }),
      web_visitor_id: null,
      install_id: "i2",
      account_id: null,
    });
    await resolver.link(
      WORKSPACE,
      { type: "install", id: "i2" },
      { type: "web_visitor", id: "v2" },
      "token"
    );

    await squash(store);
    const second = await squash(store);
    expect(second).toEqual({ groups: 0, overridesDrained: 0, eventsRewritten: 0 });
  });

  test("nothing pending is not an error", async () => {
    const { store } = fresh();
    expect(await squash(store)).toEqual({ groups: 0, overridesDrained: 0, eventsRewritten: 0 });
  });

  test("queries are correct before squash runs, via the override", async () => {
    const { store, resolver } = fresh();
    const link = await resolver.link(
      WORKSPACE,
      { type: "install", id: "i3" },
      { type: "web_visitor", id: "v3" },
      "token"
    );

    // Squash has not run. The override table alone has to carry the answer.
    const overrides = await store.getOverrides(WORKSPACE, [
      { type: "install", id: "i3" },
      { type: "web_visitor", id: "v3" },
    ]);
    const resolved = new Set([
      overrides.get("install i3") ?? (await resolver.resolve(WORKSPACE, { type: "install", id: "i3" })),
      overrides.get("web_visitor v3") ??
        (await resolver.resolve(WORKSPACE, { type: "web_visitor", id: "v3" })),
    ]);
    expect(resolved).toEqual(new Set([link.person_id!]));
  });
});
