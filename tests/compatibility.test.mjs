import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import Official, {
  SESSION_QUERY_SQLITE_SCHEMA_VERSION,
} from "@deepseek-ai/dsh-session-query-sqlite";

const require = createRequire(import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("declared DSH rc.3 target matches the installed test dependencies", () => {
  assert.equal(manifest.engines.dsh, "0.2.1-rc.3");
  assert.equal(
    manifest.version,
    manifest.engines.dsh,
    "Plugin version must exactly match DSH",
  );
  assert.equal(manifest.publishConfig.tag, "latest");
  for (const name of [
    "@deepseek-ai/dsh-session-query",
    "@deepseek-ai/dsh-session-query-sqlite",
  ]) {
    assert.equal(manifest.peerDependencies[name], manifest.version, name);
  }
  assert.equal(manifest.peerDependencies["@deepseek-ai/cordis"], "4.0.5");
  for (const name of [
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-session-query",
    "@deepseek-ai/dsh-session-query-sqlite",
  ]) {
    assert.equal(
      require(name + "/package.json").version,
      manifest.peerDependencies[name],
      name,
    );
  }
  assert.equal(
    manifest.devDependencies["@deepseek-ai/dsh-session"],
    manifest.engines.dsh,
  );
  assert.equal(
    require("@deepseek-ai/dsh-session/package.json").version,
    manifest.engines.dsh,
  );
});

test("RC SQLite schema and private adapter methods remain available", () => {
  assert.equal(SESSION_QUERY_SQLITE_SCHEMA_VERSION, 8);
  for (const method of [
    "_serialized",
    "_ensureReady",
    "_requireDb",
    "_isClosed",
    "_mainGeneration",
    "_reconcile",
    "_deleteSession",
    "_replacePersistedSession",
    "_replaceLiveSession",
    "_close",
  ]) {
    assert.equal(typeof Official.prototype[method], "function", method);
  }
});
