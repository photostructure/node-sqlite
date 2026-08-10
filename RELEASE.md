# Releasing `@photostructure/sqlite`

A release starts from a tested `main` commit and ends with a maintainer approving a
staged package on npm with 2FA. Do not create or move a version tag by hand, and do
not run `npm publish` from a workstation.

Two workflows do the work:

| Workflow                             | Trigger                | Authority                              |
| ------------------------------------ | ---------------------- | -------------------------------------- |
| `Build & Release` (`build.yml`)      | dispatch on `main`     | pushes the signed release commit + tag |
| `Stage npm Release` (`publish.yaml`) | dispatched at that tag | stages one tarball on npm              |

Only `publish.yaml`'s `stage` job can publish. It checks out nothing, installs no
project dependencies, runs no third-party action, and holds no repository secret.

## Before a release

- The intended commit is on `main` and its CI run is green.
- `CHANGELOG.md` has the release notes. Run `/preflight` first if upstream Node.js or
  SQLite sources need syncing.
- `package.json`'s `version` is untouched — `build.yml` bumps it.
- npm's Trusted Publisher for `@photostructure/sqlite` names `photostructure/node-sqlite`
  and `publish.yaml`.
- Actions can read `SSH_SIGNING_KEY`, `GIT_USER_NAME`, and `GIT_USER_EMAIL`.

## Release

1. Open **Build & Release** in GitHub Actions and **Run workflow** on `main`.
2. Choose `patch`, `minor`, or `major`.
3. Wait for lint, the eight prebuilds, the test matrix, and the packed-package checks.
   The release job then creates one signed commit and one signed `vX.Y.Z` annotated
   tag, pushes them atomically, and starts **Stage npm Release** at that tag.
4. Wait for **Stage npm Release**. It rebuilds all eight prebuilds from the tag,
   packs one tarball, installs and loads it on Linux, macOS, Windows, and Alpine
   across Node.js 22, 24, and 26, and stages that exact tarball on npm.

## Approve the staged package

1. Download the `npm-package-vX.Y.Z` artifact from the run. Check that
   `CONTENTS.txt` lists all eight prebuilds and that `PACK.json` names the tag's
   version.
2. Open **Staged Packages** from the npm user menu.
3. Confirm the package name, version, file list, and that provenance identifies this
   repository, `publish.yaml`, the release tag, and the tag's target commit.
4. Approve with 2FA, then confirm npm lists the version publicly.
5. Confirm the immutable GitHub release exists for the same tag.

The CLI works too, and still requires 2FA: `npm stage list`, `npm stage view <id>`,
then `npm stage approve <id>` or `npm stage reject <id>`.

The GitHub release is created once npm accepts the stage, so it can exist before the
package is publicly visible.

## What the workflows enforce

- `build.yml` packs, installs, and loads a tarball on every push to `main`.
  `publish.yaml` is frozen at the tag it runs from, so that procedure must never run
  for the first time during a release.
- The release job changes only `package.json` and `package-lock.json`, signs the
  commit and tag, and pushes them atomically. It installs no dependencies.
- `publish.yaml` accepts only a signed `vMAJOR.MINOR.PATCH` annotated tag whose
  package name, repository URL, version, and target commit match the workflow ref. It
  rechecks that identity in the staging job and again before creating the release.
- All eight native binaries are rebuilt from the tag, and `pack` refuses to package
  unless exactly those eight are present -- a missing one would silently push
  consumers on that platform into compiling from source. `assertPackedContents` then
  confirms each one made it into the tarball.
- Artifact integrity between jobs is `actions/download-artifact`'s job: it hashes
  every artifact and fails on `digest-mismatch` by default.
- The packed tarball is installed with `--ignore-scripts`, so the load check proves
  the packed prebuild resolves rather than a local source build.

## Failure recovery

| Failure                               | Response                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| A pre-tag job fails                   | Fix `main` and dispatch again. No tag exists yet.                                   |
| `main` moved during the run           | Dispatch again from the new head.                                                   |
| Tag or signature validation fails     | Correct the release identity. Do not bypass validation.                             |
| The tag exists but dispatch failed    | Rerun the dispatch job, or run `publish.yaml` at that exact tag. Do not bump again. |
| A tagged build or package check fails | Fix `main` and release a new version. Never move the tag.                           |
| The staged package is wrong           | Reject the stage and release a new version.                                         |
| An approved release is bad            | Deprecate it or publish a corrected version. Never overwrite it.                    |

## After a workflow change

For the first release following any change to `build.yml`, `publish.yaml`, or the
`scripts/release-*` tooling, record:

- both workflow run URLs;
- the signed tag and its target commit SHA;
- the staged-package approval time;
- the npm package and GitHub release URLs; and
- `npm view @photostructure/sqlite@X.Y.Z version gitHead dist.integrity --json`.

`gitHead` must equal the release tag's target commit.
