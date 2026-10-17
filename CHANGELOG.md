# Changelog

## 0.2.1-alpha.4

- Publish through the `latest` npm channel, independently of prerelease version suffixes.

- Declare exact DSH 0.2.1-rc.2 compatibility through `engines.dsh`, pinned RC peers and Cordis 4.0.5. This
  replaces the alpha.3 host target; the plugin keeps its independent release version.
- Validate the RC SQLite schema-8 adapter against published packages using real Cordis/SQLite services and
  synthetic session data. Full installed-profile and sustained/restart validation remain outside this
  compatibility check.

## 0.2.1-alpha.3

- Initial experimental extraction of the local incremental-index workaround.
- Pinned DSH 0.2.1-alpha.3/schema-8 compatibility, bounded background updates, per-session validation,
  transactional replacement, and synthetic tests.
- Eventual consistency is intentional; cross-platform and sustained/restart stability are not certified.
