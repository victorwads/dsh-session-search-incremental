# Publishing

This repository follows the dsh-live-voice release pattern: validation on push/PR, and manual publication from
main with GitHub Actions, npm trusted publishing (OIDC), provenance, a version tag and GitHub Release. It uses
npm rather than copying the unrelated pnpm monorepo build. Runtime files are already authored JavaScript.

## First publication (bootstrap from your terminal)

The npm package must exist before you configure its trusted publisher. Review and commit the intended release
files, push them to the public repository, and wait for CI before publishing. Do not publish an unreviewed
working tree. Sign in with the npm account that will own the package:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
npm ci
npm run check
npm test
npm publish --dry-run --access public --tag latest --registry=https://registry.npmjs.org/
npm publish --access public --tag latest --registry=https://registry.npmjs.org/
```

The package publishes under **latest**, including versions with a prerelease suffix. npm may ask for 2FA. The
dry run does not publish anything. Local bootstrap does not provide GitHub Actions provenance. Publishing
creates an immutable npm version; do not immediately dispatch CI for that same version.

## Configure OIDC once after bootstrap

1. Create a GitHub environment named **npm** in this repository; configure reviewers/main-only protection as
   desired.
2. In npm package Settings → Trusted publishing, select GitHub Actions:
   - Organization/user: **victorwads**
   - Repository: **dsh-session-search-incremental**
   - Workflow filename: **publish.yml** (filename only)
   - Environment: **npm**
3. Keep the repository public for public provenance. OIDC needs no NPM_TOKEN secret.

See [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

## Subsequent releases

Set the package version to the exact supported DSH version, including its prerelease suffix, and align
`engines.dsh`, DSH peers and lockfile. Do not increment an independent plugin version. The current release is
**0.2.1-rc.3 for DSH 0.2.1-rc.3**, on **latest**. If that version already exists on npm, stop and ask the
maintainer rather than inventing a patch or prerelease. Review, commit, and push main:

```sh
# Example for this DSH target (only if not already set):
npm version 0.2.1-rc.3 --no-git-tag-version
# Review changes, then commit and push main; wait for CI.
gh workflow run publish.yml --repo victorwads/dsh-session-search-incremental --ref main
```

Dispatch is manual: pushing a commit or tag does not publish. The workflow validates metadata, runs tests,
checks for an existing npm version/Git tag, performs a publication dry run, and publishes with
OIDC/provenance. Only after npm publication succeeds does it create the tag and GitHub Release, avoiding a
blocked retry when OIDC authentication fails. If npm succeeds but GitHub tag/release creation fails, finish
the GitHub steps manually for the published commit; do not attempt to republish or unpublish that version.

The npm dist-tag is always **latest**, independently of the version prerelease identifier. Keep
publishConfig.tag set to latest. The workflow deliberately rejects already-published versions, including the
bootstrap version. CI must be available on main before dispatch.
