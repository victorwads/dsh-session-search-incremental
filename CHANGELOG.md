# Changelog

## 0.2.1-rc.2

- Align the plugin version exactly with supported DSH 0.2.1-rc.2. The previous alpha.4 version was published
  with incorrect independent versioning; this release corrects that policy and supersedes it on `latest`.
- Document version alignment in README and agent guidance, and reject mismatched plugin/DSH versions in tests
  and publication validation.

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
