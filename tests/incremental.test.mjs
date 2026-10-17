import assert from "node:assert/strict";
import { test } from "node:test";
import { Context, Service } from "@deepseek-ai/cordis";
import Sessions from "@deepseek-ai/dsh-session";
import Incremental from "../src/index.mjs";
const message = (text, seq = 0) => ({
  seq,
  time: 1700000000000 + seq,
  type: "user/message",
  surfaceOp: "append",
  data: { content: [{ type: "text", text }] },
});
async function fixture(t) {
  const records = new Map(),
    failed = new Set(),
    raced = new Set();
  let opens = 0;
  const put = (id, text = "onboarding", cwd = "/test/project") =>
    records.set(id, {
      header: { id, version: 4, createdAt: 1700000000000, cwd, isSeeded: false },
      revision: "one",
      events: [message(text)],
    });
  class Persistence extends Service {
    constructor(ctx) {
      super(ctx, "sessionPersistence");
    }
    async list() {
      return [...records.values()].map((x) => ({
        header: x.header,
        revision: x.revision,
        formatStatus: "current",
      }));
    }
    async stat(id) {
      const x = records.get(id);
      return x ? { header: x.header, revision: x.revision, formatStatus: "current" } : undefined;
    }
    async open(id) {
      opens++;
      if (failed.has(id)) throw Error("synthetic unreadable source");
      const x = records.get(id);
      if (raced.has(id)) x.revision += "-changed";
      return {
        header: x.header,
        inheritedEventCount: 0,
        async read() {
          return { events: x.events, eventState: "shared-frozen" };
        },
        async close() {},
      };
    }
  }
  const ctx = new Context(),
    fibers = [];
  async function mount(p, c) {
    const f = ctx.plugin(p, c);
    fibers.push(f);
    while (f.inertia) await f.inertia;
    assert.equal(f.state, 2);
  }
  await mount(Sessions);
  await mount(Persistence);
  await mount(Incremental, { path: ":memory:", openAt: "startup" });
  const q = ctx.sessionQuery;
  clearTimeout(q.timer);
  q.timer = undefined;
  t.after(async () => {
    for (const f of fibers.reverse()) await f.dispose();
  });
  const sync = async () => {
    await q.refreshListing(undefined, true);
    await q.batch(100);
  };
  return { ctx, q, put, records, failed, raced, sync, opens: () => opens, db: q._requireDb() };
}
test("new sessions and appends replace documents without duplicates", async (t) => {
  const f = await fixture(t);
  f.put("one");
  await f.sync();
  assert.equal((await f.q.searchSessions({ query: "onboarding" })).items.length, 1);
  f.records.get("one").events.push(message("newmarker", 1));
  f.records.get("one").revision = "two";
  await f.sync();
  assert.equal((await f.q.searchSessions({ query: "newmarker" })).items.length, 1);
  assert.equal(f.db.prepare("SELECT count(*) n FROM persisted_docs").get().n, 2);
  assert.equal(f.db.prepare("PRAGMA quick_check").get().quick_check, "ok");
});
test("device-only revision changes are read and verified", async (t) => {
  const f = await fixture(t);
  f.put("one");
  await f.sync();
  const before = f.opens();
  f.records.get("one").revision = "different-device";
  await f.sync();
  assert.equal(f.opens(), before + 1);
  assert.equal(f.db.prepare("SELECT revision FROM persisted_sessions").get().revision, "different-device");
  assert.equal(f.db.prepare("SELECT count(*) n FROM persisted_docs").get().n, 1);
});
test("racing and unreadable sources do not block healthy sessions", async (t) => {
  const f = await fixture(t);
  for (const id of ["racing", "broken", "healthy"]) f.put(id);
  f.raced.add("racing");
  f.failed.add("broken");
  await f.sync();
  assert(f.q.pending.has("racing"));
  assert(f.q.failures.has("broken"));
  assert(f.q.hasPersisted("healthy"));
  assert(!f.q.hasPersisted("racing"));
});
test("membership deletion preserves unrelated documents", async (t) => {
  const f = await fixture(t);
  f.put("removed");
  f.put("kept");
  await f.sync();
  f.records.delete("removed");
  await f.sync();
  assert(!f.q.hasPersisted("removed"));
  assert(f.q.hasPersisted("kept"));
  assert.equal(f.db.prepare("SELECT count(*) n FROM persisted_docs").get().n, 1);
});
test("replacement failure rolls back to last valid index", async (t) => {
  const f = await fixture(t);
  f.put("one");
  await f.sync();
  f.records.get("one").revision = "two";
  f.records.get("one").events = [message("replacement")];
  const original = f.q._replacePersistedSession.bind(f.q);
  f.q._replacePersistedSession = (...args) => {
    original(...args);
    throw Error("synthetic failure");
  };
  await f.sync();
  assert.equal((await f.q.searchSessions({ query: "onboarding" })).items.length, 1);
  assert.equal(f.db.prepare("SELECT revision FROM persisted_sessions").get().revision, "one");
  assert.equal(f.db.prepare("PRAGMA quick_check").get().quick_check, "ok");
});
test("official workspace predicates and event search still apply", async (t) => {
  const f = await fixture(t);
  f.put("a", "onboarding", "/test/a");
  f.put("b", "onboarding", "/test/b");
  await f.sync();
  assert.equal(
    (
      await f.q.searchSessions({
        query: "onboarding",
        sessionFilters: [{ kind: "cwd", values: ["/test/a"] }],
      })
    ).items.length,
    1,
  );
  assert.equal((await f.q.searchEvents({ sessionId: "a", query: "onboarding" })).items.length, 1);
});
test("batch limits number of reads", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 6; i++) f.put("id-" + i);
  await f.q.refreshListing(undefined, true);
  await f.q.batch(2);
  assert.equal(f.opens(), 2);
  assert.equal(f.q.status().pending, 4);
});
test("background indexes without a search", async (t) => {
  const f = await fixture(t);
  f.put("background");
  await f.q.background();
  assert(f.q.hasPersisted("background"));
});
test("abort prevents committing unread sources", async (t) => {
  const f = await fixture(t);
  f.put("one");
  const c = new AbortController();
  c.abort();
  await assert.rejects(() => f.q._reconcile(c.signal));
  assert(!f.q.hasPersisted("one"));
});
