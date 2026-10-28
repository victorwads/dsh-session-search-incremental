# Agent guide

## Scope and version policy

- Work only in this repository unless the user explicitly authorizes another scope.
- The plugin version MUST exactly match the supported DSH version, including prerelease identifiers. Current
  target: **0.2.2-alpha.2** for both plugin and DSH. There is no independent plugin release sequence.
- Keep package.json.version, engines.dsh, DSH peer versions, test dependency versions and lockfile aligned.
  Cordis uses its own upstream version, not the DSH version. For DSH 0.2.2-alpha.2, Cordis is ~4.0.6-alpha.1.
- Always publish to npm dist-tag **latest**, including DSH alpha/rc versions. Do not infer a dist-tag from the
  version suffix. Keep publishConfig.tag and the publication workflow set to latest.
- If the matching version is already published, STOP and ask the maintainer. npm versions are immutable; never
  invent another plugin patch/prerelease, unpublish, or delete release history to get around this.
- The historical alpha.4 publication used incorrect independent versioning; do not repeat that policy.

## Safety and validation

- Read README.md and RELEASING.md before release work. Preserve eventual-consistency and compatibility limits.
- The adapter uses private DSH SQLite methods: inspect upstream contracts and test the exact pinned DSH
  packages before declaring compatibility. Schema version alone is not proof of compatibility.
- Keep dsh-deeplink an optional companion, never a required dependency.
- Run npm ci, npm run check, npm test and npm pack --dry-run before release. Report synthetic integration
  checks separately from full installed-profile, cross-platform and sustained/restart validation.
- Commit, push, publish and workflow dispatch require explicit user authorization for the current work.
- Publication uses the manual main-only GitHub Actions workflow, environment npm, OIDC and provenance. Never
  bypass duplicate-version guards or use tokens as a silent fallback.
