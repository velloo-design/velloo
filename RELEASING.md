# Releasing

Velloo publishes as one npm package named `velloo`. It declares exact-version
official `@oven/bun-*` optional dependencies, so npm selects a private Bun 1.4
binary without running an install script. `npm install -g velloo` is canonical;
users do not install Bun. The release also ships checksum-verified standalone
archives for the macOS/Linux curl installer. Workspace manifests stay private.

## Versioning

Semver, pre-1.0 flavor: breaking changes to the CLI, the design-folder format,
or the MCP surface bump the **minor**; everything else bumps the **patch**.

## Process

1. **Bump the version** in `packages/cli/package.json` — it is the source of
   truth for the published version (`build.ts` reads it). Keep the root
   `package.json` version in step for tidiness.
2. **Update `CHANGELOG.md`**: retitle the `Unreleased` section to the new
   version + date, and start a fresh empty `Unreleased` above it.
3. **Commit** on `main`, then tag and push:

   ```bash
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

4. The tag push triggers `.github/workflows/release.yml`, which:
   - runs the gates (typecheck, lint, `bun test`),
   - verifies the tag matches `packages/cli/package.json`,
   - builds the bundle with the hosted cloud default baked in
     (`VELLOO_BUILD_CLOUD_URL=https://api.velloo.ai`),
   - resolves exact official `@oven/bun-*` binaries for each direct target,
   - builds immutable direct archives + SHA-256 files and a version-baked
     `install.sh`,
   - publishes `velloo` with npm provenance,
   - uploads the direct surface to the download bucket and attaches all
     artifacts to the GitHub release.

5. **Verify**: `npm install -g velloo@X.Y.Z && velloo --version` from a clean prefix.

## Local dry run

```bash
bun packages/cli/build.ts
bun scripts/package-smoke-test.ts
```

`bun run cli:install` installs the same artifact globally (localhost cloud
default); `bun run cli:prod` bakes the hosted cloud URL like the release build,
and `bun run cli:dev` bakes the dev environment (`https://api.dev.velloo.ai`).

## Dogfood channel

Testers can run unreleased builds from `get.velloo.design` (prod) or
`get.dev.velloo.design` (dev). A dogfood publish builds the bundle with that
environment's cloud URL and update channel baked in, then uploads `install.sh`,
the npm tarball, direct archives, and checksums to the environment's bucket
under `downloads/`. It never touches npm or GitHub releases.

The normal path is CI, so upload credentials never leave GitHub:

```bash
gh workflow run dogfood.yml -f environment=dev    # or prod
```

`dogfood.yml` and `release.yml` read `BLOB_ENDPOINT`, `BLOB_BUCKET`,
`BLOB_ACCESS_KEY`, and `BLOB_SECRET_KEY` from the GitHub environment of the same
name (`dev` / `prod`); `NPM_TOKEN` lives on `prod`.

A maintainer holding the credentials can publish from their machine instead:
`bun run cli:release` (prod) / `bun run cli:release:dev` read the four `BLOB_*`
values from the environment, or from a gitignored `.env.release.prod` /
`.env.release.dev` at the repo root.
