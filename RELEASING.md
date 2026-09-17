# Releasing

Velloo publishes as one npm package named `velloo`. It declares exact-version
official `@oven/bun-*` optional dependencies, so npm selects a private Bun 1.4
binary without running an install script. `npm install -g velloo` is canonical;
users do not install Bun. Each release also ships checksum-verified standalone
archives for the macOS/Linux curl installer. Workspace manifests stay private.

## Channels

| Channel | Built from | Published to | Update check |
|---|---|---|---|
| **stable** | the manual **Release** workflow | npm, a `vX.Y.Z` GitHub release, `get.velloo.design` | npm registry, or `latest.json` for curl installs |
| **dev** | every push to `main` that passes CI (`dogfood.yml`) | the rolling `dev` GitHub prerelease, `get.dev.velloo.design` | `latest.json` on the dev host |
| **local** | `bun run cli:build` / `cli:install` | this machine | the build marker in `~/.velloo` |

Dev builds bake the dev cloud (`https://api.dev.velloo.ai`) and never reach npm.
The dev cloud is a private environment: `velloo login` and `velloo publish`
from a dev build only work for accounts on its allowlist. Everyone else is
turned away with a link to `https://dev.velloo.ai/request-access`, so install
the stable channel to publish to the public cloud. A dev build can also target
another cloud for a single command with `VELLOO_CLOUD_URL` or `--url`.

## Versions

Git tags are the source of truth. `scripts/release-version.ts` takes the latest
`vX.Y.Z` tag and applies the bump you choose; the repo's `package.json` is never
bumped — it stays the version local builds report — and CI stamps the computed
version into its own checkout before building. A dev build is a prerelease of
the next patch numbered by commits since the last release (`0.2.1-dev.14`), so
it always sorts after the release it builds on.

Semver, pre-1.0 flavor: breaking changes to the CLI, the design-folder format,
or the MCP surface bump the **minor**; everything else bumps the **patch**.

## Cutting a release

1. **Preview the notes**: `bun run release:notes` prints what the GitHub release
   will say — grouped from the conventional-commit subjects since the last tag.
   A subject is the whole entry, so fix a bad one before releasing.
2. **Start the release** from `main`:

   ```bash
   gh workflow run release.yml -f bump=minor   # patch | minor | major
   ```

   (or Actions → Release → Run workflow).
3. **Approve** the `prod` deployment when GitHub asks.
4. `release.yml` then:
   - runs the gates (typecheck, lint, tests, and `bun run notices:check`, which
     fails when `THIRD-PARTY-NOTICES.md` is stale or a dependency's license is unreviewed),
   - computes the version and writes the release notes,
   - builds the npm package and direct archives with the hosted cloud baked in,
     and smoke-tests both installs,
   - attests the artifacts' build provenance,
   - mirrors them to the download bucket (while that is configured),
   - publishes `velloo` to npm through trusted publishing,
   - creates the `vX.Y.Z` tag and GitHub release with the notes and artifacts,
   - notifies the downstream repositories (docs site, website, cloud).

   Re-running a failed release is safe: once `main`'s head carries the new
   tag the version is reused rather than bumped again, npm is skipped when the
   version is already there, and an existing release gets its assets replaced.
5. **Verify**: `npm install -g velloo@X.Y.Z && velloo --version` from a clean prefix.

## Fixing the installer without a release

`install.sh` is baked per release, but it is also what `velloo upgrade` fetches
on every curl install, so an installer bug is worth shipping on its own. The
**Installer** workflow republishes only `install.sh` on one host, pinned to the
version that host's `latest.json` already serves — no binaries, npm, or tag:

```bash
gh workflow run installer.yml -f channel=prod
```

It refuses when any platform archive for that version is missing, and reads the
file back through the host to confirm. `prod` waits for approval like a release.
The dev host needs this only between dev builds: every green push to `main`
republishes its installer anyway.

## Credentials

Nothing long-lived can publish to npm. The package trusts this repository's
`release.yml` running in the `prod` environment (npm → package settings →
Trusted publisher); npm exchanges that job's OIDC token for a one-time publish
token. Release assets are uploaded with the job's own `GITHUB_TOKEN`.

| Environment | Deploys from | Secrets |
|---|---|---|
| `dev` | `main` | `BLOB_*` — optional, only while the dev host mirrors from its bucket |
| `prod` | `main`, with a required reviewer | `BLOB_*` (same caveat); `RELEASE_APP_PRIVATE_KEY` for the downstream notification |

The downstream notification sends a `velloo-release` repository dispatch, with
the version in its payload, to each repository in the `DOWNSTREAM_REPOS`
variable (comma-separated, same organization). It authenticates as a GitHub App
installed on just those repositories — its client ID in the
`RELEASE_APP_CLIENT_ID` variable, its private key in the `prod` secret above.
Leave `DOWNSTREAM_REPOS` unset to skip it.

## Local dry run

```bash
bun packages/cli/build.ts
bun scripts/package-smoke-test.ts
```

`bun run cli:install` installs the same artifact globally (localhost cloud
default); `bun run cli:prod` bakes the hosted cloud URL like the release build,
and `bun run cli:dev` bakes the dev environment (`https://api.dev.velloo.ai`).
