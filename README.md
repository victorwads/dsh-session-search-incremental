# DSH Incremental Session Search

**Experimental independent workaround for DSH 0.2.1-rc.2. Not an official DSH fix.**

Reuses the official SQLite FTS query/extraction implementation, but replaces whole-corpus reconciliation with
independent bounded session updates. Searches use the last indexed state while a background queue catches up.
**Results are eventually consistent and may be incomplete or stale. A fast search is not proof of
completeness.**

Context: https://github.com/deepseek-ai/deepseek-harness/discussions/8783

## Why

Legacy revisions can depend on a store-wide hash; filesystem device metadata changes can also invalidate many
otherwise unchanged revisions. This plugin does not strip or falsify these revisions. It rereads each affected
session, validates its revision before and after reading, and commits stable sessions independently. A write
or failure in another session need not discard all progress.

## Behavior and limits

- Targets **DSH 0.2.1-rc.2**, Node **22.23+**, derived SQLite schema **8**. `engines.dsh` declares this exact
  host version; DSH peers are pinned to **0.2.1-rc.2** and Cordis to **4.0.5**. Other host versions, including
  the former alpha.3 target, are not declared compatible by this manifest. The plugin version is independent
  of the DSH host version.
- Compatibility was checked against the published RC packages using real Cordis/SQLite services and synthetic
  in-memory session data, not a full installed Web profile or sustained/restart workload.
- Uses private engine methods: revalidate before upgrading DSH. The schema guard alone does not guarantee API
  compatibility.
- Background cycles run about one second after the previous cycle completes. Listing is refreshed at most
  every two seconds. Batches read at most two non-attached sessions, with previously unseen sessions
  prioritized.
- Searches can read up to two unseen cold sessions and refresh changed attached sessions in connection-local
  TEMP tables. Attached sessions are not continuously copied into the main durable index.
- A session changed during reading is requeued. An unreadable source logs a warning and is retried after 30
  seconds; other sessions still progress. A legacy session whose own dependency revision never stabilizes can
  remain pending.
- Replacements are transactional; a failed replacement preserves the old indexed content. The plugin never
  writes, migrates or deletes canonical conversation logs. It deletes derived entries only after a successful
  listing no longer contains the session and it is not attached.
- Fingerprints are process-local. Invalidated sessions are reread after restart. An in-memory rowid map
  proportional to document count accelerates replacements.
- **Use one provider/writer per derived database.** Operations are serialized. Two sessions is a count limit,
  not a time guarantee: listing, a huge source, initial rowid scanning or FTS writes can still delay a
  request. There is no hard per-source timeout.
- Archive status is not an exclusion filter. DSH still controls visibility/authorization; Agent workspace
  restrictions are not bypassed.
- No custom settings page or freshness badge yet. Programmatic diagnostics: `ctx.sessionQuery.status()`
  exposes eventual-consistency mode, pending count, failures and last listing time. Attached pending sessions
  can already be searchable via TEMP. Logs may contain IDs/paths: redact before sharing.
- Not suitable as an authoritative time ledger. Use canonical logs and consider gaps/overlaps.

## Install from npm

Install the package from the `latest` npm channel into the profile serving your Web GUI:

```sh
dsh plugin --profile web add dsh-session-search-incremental@latest
```

Keep this bundle **after** the official base/search bundles. Restart the existing DSH process after
installation. Review the database, single-writer and rollback guidance below before enabling it.

## Recommended companion: dsh-deeplink

Pair this provider with [dsh-deeplink](https://github.com/victorwads/dsh-deeplink) to turn discovered
conversations and workspaces into clickable links in the DSH Web GUI. The search provider finds context; the
deep-link plugin guides the model through the exposed search/read/trace tools and opens the resulting links in
the same tab, using the browser's actual origin and application path.

After both packages are published:

```sh
dsh plugin --profile web add dsh-deeplink dsh-session-search-incremental@latest
```

They are **optional companions, not runtime dependencies of one another**. Deep links also work with the
standard DSH search provider, and incremental search does not need the deep-link UI. Neither package grants
access to otherwise unauthorized conversations. Search results remain eventually consistent: an empty result
does not prove a conversation is absent. Do not enable both scoped and unscoped deep-link packages.

## Local installation

No npm publication required. Clone and install pinned dependencies:

```sh
git clone https://github.com/victorwads/dsh-session-search-incremental.git
cd dsh-session-search-incremental
npm ci
npm test
```

In the DSH Web profile package manifest, add (adapt clone location):

```json
"dsh-session-search-incremental": "link:~/GitRepos/dsh/dsh-session-search-incremental"
```

Append `dsh-session-search-incremental` to `dsh.profile.bundles`, **after** the official base and optional
search bundles, then install profile dependencies with its package manager. Standard profiles use pnpm. The
local DSH link convention uses `link:~/...`; if installing with plain pnpm outside DSH, normalize that link to
an absolute path in the installation command/lockfile if your pnpm does not expand the tilde.

The bundle disables both standard SQLite providers and clears the optional search bundle isolation, so UI and
Agent tools use one provider. Review composition if you customized isolation or providers. Do not mount
another copy by absolute file path. The installed bundle provides plugin metadata via its package manifest; it
has no custom client settings panel.

Default DB: `./session-search-incremental.sqlite`, relative to host working directory. Prefer an explicit
writable absolute path in your profile patch:

```yaml
- id: session-search-incremental
  config:
    path: /absolute/path/to/session-search-incremental.sqlite
    openAt: startup
```

**Back up configuration and index before switching.** A separate fresh index is safest for evaluation; it
fills gradually. A schema-8 index can be reused only without competing writers. No replacement Web
server/browser build is needed. Honor restart-required notices; do not assume hot reload succeeded.

## Verification and rollback

Search an old phrase through UI and tools; add a unique phrase in a new conversation and verify it appears
without rebuilding. Repeat after continued activity/restart and inspect pending/errors. No single successful
query proves completeness.

To uninstall: remove this bundle, restore the official providers and previous isolation settings, remove any
local override for this provider, then reload/restart as required. Preserve the derived DB until rollback is
verified. Never remove canonical session storage.

## Development

```sh
npm ci
npm run check
npm test
npm pack --dry-run
```

Tests use synthetic in-memory sessions only: appends, metadata invalidation, write races, unreadable sources,
rollback, membership deletion, workspace predicates, event search, bounded batches, cancellation and
background progress. No private logs, recovery databases or user-specific paths are bundled. Cross-platform
and long-running/restart stability remain unverified.

## Publishing

See the [release guide](RELEASING.md) for first-publication commands and the manual GitHub Actions/OIDC
workflow. The package publishes under `latest`, including versions with a prerelease suffix.

## License

MIT. Official dependency licenses remain applicable; see NOTICE.
