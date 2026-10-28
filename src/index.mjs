import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import Official, { SESSION_QUERY_SQLITE_SCHEMA_VERSION } from "@deepseek-ai/dsh-session-query-sqlite";
import {
  readColdSessionLog,
  buildSessionEventSearchDocuments,
  assertSessionHeadersCompatible,
} from "@deepseek-ai/dsh-session-query";
import { Service } from "@deepseek-ai/cordis";

function observation(header, inheritedEventCount, events) {
  return {
    header,
    inheritedEventCount,
    documents: buildSessionEventSearchDocuments(header.id, events),
    fingerprint: createHash("sha256")
      .update(JSON.stringify({ header, inheritedEventCount, events }))
      .digest("base64url"),
  };
}
function check(signal) {
  signal?.throwIfAborted();
}
// Experimental DSH 0.2.2-alpha.2 adapter: preserve official query/filter/cursor semantics,
// validate cold sources independently, and never make a search read the full corpus.
export default class IncrementalQuery extends Official {
  fingerprints = new Map();
  liveSeq = new Map();
  failures = new Map();
  pending = new Set();
  lastListing = 0;
  snapshots = new Map();
  timer;
  stopping = false;
  rowIds;
  rowIdsGeneration = -1;
  bindingIdentity;
  async [Service.init]() {
    await super[Service.init]();
    if (SESSION_QUERY_SQLITE_SCHEMA_VERSION !== 8)
      throw new Error("Unsupported DSH search schema; expected 8");
    this.schedule(100);
  }
  schedule(ms = 1000) {
    if (this.stopping || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.background()
        .catch((e) => this.ctx.logger.warn("incremental-index background: " + String(e)))
        .finally(() => this.schedule());
    }, ms);
    this.timer.unref?.();
  }
  async background() {
    if (this._isClosed() || this.config.openAt === "never") return;
    await this._serialized(undefined, async () => {
      await this._ensureReady();
      await this.refreshListing();
      await this.batch(2);
    });
  }
  async refreshListing(signal, force = false) {
    this.resetBinding();
    const p = this._persistenceBinding.service;
    if (!p) return;
    if (!force && Date.now() - this.lastListing < 2000) return;
    const rows = await p.list(signal ? { signal } : undefined);
    check(signal);
    const next = new Map(rows.map((x) => [x.header.id, x]));
    const stored = this._requireDb().prepare("SELECT id,revision FROM persisted_sessions").all();
    const storedById = new Map(stored.map((x) => [x.id, x]));
    for (const x of rows) {
      const existing = storedById.get(x.header.id);
      if (existing?.revision !== x.revision) this.pending.add(x.header.id);
      else this.pending.delete(x.header.id);
    }
    // Delete only after a completed real listing; never confuse a bounded batch with membership.
    await this.ensureRowIds();
    for (const s of stored)
      if (!next.has(s.id) && !this.ctx.sessions.get(s.id)) {
        this.commit(() => this._deleteSession("persisted", s.id));
        this.fingerprints.delete(s.id);
        this.pending.delete(s.id);
      }
    this.snapshots = next;
    this.lastListing = Date.now();
  }
  commit(fn) {
    const db = this._requireDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      const generation = this._mainGeneration() + 1;
      if (this.rowIds && this.rowIdsGeneration !== generation - 1) this.loadRowIds();
      fn(generation);
      db.prepare("UPDATE search_state SET global_generation=? WHERE singleton=1").run(generation);
      db.exec("COMMIT");
      this.rowIdsGeneration = generation;
      this._globalGeneration = Math.max(this._globalGeneration + 1, generation);
      return generation;
    } catch (e) {
      db.exec("ROLLBACK");
      this.rowIds = undefined;
      this.rowIdsGeneration = -1;
      throw e;
    }
  }
  async ensureRowIds() {
    if (this.rowIds && this.rowIdsGeneration === this._mainGeneration()) return;
    this.loadRowIds();
  }
  loadRowIds() {
    const map = new Map();
    for (const r of this._requireDb()
      .prepare("SELECT id,c1 AS session_id FROM persisted_docs_content")
      .iterate()) {
      let ids = map.get(r.session_id);
      if (!ids) map.set(r.session_id, (ids = []));
      ids.push(r.id);
    }
    this.rowIds = map;
    this.rowIdsGeneration = this._mainGeneration();
  }
  _deleteSession(kind, id) {
    if (kind !== "persisted" || !this.rowIds) return super._deleteSession(kind, id);
    const db = this._requireDb();
    const statement = db.prepare("DELETE FROM persisted_docs WHERE rowid=?");
    for (const rowid of this.rowIds.get(id) ?? []) statement.run(rowid);
    this.rowIds.delete(id);
    db.prepare("DELETE FROM persisted_sessions WHERE id=?").run(id);
  }
  _replacePersistedSession(entry, revision, generation) {
    const db = this._requireDb();
    super._replacePersistedSession(entry, revision, generation);
    // Replacement allocates contiguous FTS rowids, owned by the transaction.
    const end = Number(db.prepare("SELECT last_insert_rowid() AS id").get().id);
    this.rowIds?.set(
      entry.header.id,
      Array.from({ length: entry.documents.length }, (_, i) => end - entry.documents.length + 1 + i),
    );
  }
  async updateOne(id, signal) {
    const p = this._persistenceBinding.service;
    if (!p) return false;
    const before = await p.stat(id, signal ? { signal } : undefined);
    if (!before) {
      this.pending.delete(id);
      return false;
    }
    const loaded = await readColdSessionLog(p, id, signal);
    check(signal);
    const after = await p.stat(id, signal ? { signal } : undefined);
    check(signal);
    if (!after || before.revision !== after.revision) {
      this.pending.delete(id);
      this.pending.add(id);
      return false;
    }
    assertSessionHeadersCompatible(before.header, loaded.header);
    assertSessionHeadersCompatible(after.header, loaded.header);
    const entry = observation(loaded.header, loaded.inheritedEventCount, loaded.events);
    if (
      this.fingerprints.get(id) === entry.fingerprint &&
      this._requireDb().prepare("SELECT 1 FROM persisted_sessions WHERE id=?").get(id)
    ) {
      this.commit(() =>
        this._requireDb()
          .prepare("UPDATE persisted_sessions SET revision=? WHERE id=?")
          .run(after.revision, id),
      );
    } else {
      await this.ensureRowIds();
      this.commit((g) => this._replacePersistedSession(entry, after.revision, g));
      this.fingerprints.set(id, entry.fingerprint);
    }
    this.pending.delete(id);
    this.failures.delete(id);
    return true;
  }
  async batch(limit = 2, signal, onlyIds) {
    const ids =
      onlyIds ??
      [...this.pending].sort((a, b) => Number(this.hasPersisted(a)) - Number(this.hasPersisted(b)));
    let count = 0;
    for (const id of ids) {
      if (count >= limit) break;
      check(signal);
      if (this.ctx.sessions.get(id)) continue;
      const fail = this.failures.get(id);
      if (fail && Date.now() - fail.time < 30000) continue;
      count++;
      try {
        await this.updateOne(id, signal);
      } catch (e) {
        if (signal?.aborted) throw e;
        this.failures.set(id, { time: Date.now(), error: String(e) });
        this.ctx.logger.warn("incremental-index session " + id + ": " + String(e));
      }
      await delay(0);
    }
  }
  async _reconcile(signal) {
    check(signal);
    this.resetBinding();
    await this.refreshListing(signal);
    // Give unseen cold sessions first priority, bounded to two reads per request.
    const db = this._requireDb();
    this._globalGeneration = Math.max(this._globalGeneration, this._mainGeneration());
    const fresh = [...this.pending].filter(
      (id) => !db.prepare("SELECT 1 FROM persisted_sessions WHERE id=?").get(id),
    );
    await this.batch(2, signal, fresh);
    const current = new Set();
    let changed = false;
    for (const session of this.ctx.sessions.list()) {
      current.add(session.id);
      const cached = this.liveSeq.get(session.id);
      const persisted = this.snapshots.has(session.id);
      if (cached?.session === session && cached.seq === session.seq && cached.persisted === persisted)
        continue;
      const entry = observation(session.header, session.inheritedEventCount, session.snapshotEvents());
      check(signal);
      const generation = ++this._localGeneration;
      this._replaceLiveSession(entry, generation, this.snapshots.has(session.id));
      this.liveSeq.set(session.id, { session, seq: session.seq, persisted });
      changed = true;
    }
    for (const r of db.prepare("SELECT id FROM temp.live_sessions").all())
      if (!current.has(r.id)) {
        this._deleteSession("live", r.id);
        this.liveSeq.delete(r.id);
        changed = true;
      }
    if (changed) this._globalGeneration++;
    this._lastPersistenceIdentity = this._persistenceBinding.identity;
    return this._persistenceBinding;
  }
  hasPersisted(id) {
    return !!this._requireDb().prepare("SELECT 1 FROM persisted_sessions WHERE id=?").get(id);
  }
  resetBinding() {
    if (this.bindingIdentity === this._persistenceBinding.identity) return;
    this.fingerprints.clear();
    this.pending.clear();
    this.failures.clear();
    this.liveSeq.clear();
    this.snapshots.clear();
    this.lastListing = 0;
    this.bindingIdentity = this._persistenceBinding.identity;
  }
  status() {
    return {
      consistency: "eventual",
      pending: this.pending.size,
      failed: [...this.failures].map(([id, x]) => ({ id, ...x })),
      lastListing: this.lastListing,
    };
  }
  async _close() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await super._close();
  }
}
