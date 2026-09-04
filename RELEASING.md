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

`bun run cli:release` (prod) / `bun run cli:release:dev` build the bundle with
the environment's cloud URL baked in and upload `install.sh`, the npm tarball,
direct archives, and checksums to that environment's R2 bucket
under `downloads/` — velloo-cloud serves them at `get.velloo.design` /
`get.dev.velloo.design`. Credentials come from the sibling
velloo-cloud checkout's `.env.prod` / `.env.dev` (override the checkout with
`VELLOO_CLOUD_DIR`, or pass `BLOB_*` directly).
