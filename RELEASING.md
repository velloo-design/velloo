# Releasing

Velloo publishes as **one bundled npm package named `velloo`** (Bun required at
runtime; `bunx velloo init` is the canonical install). The publish surface is
the `dist/package.json` that `packages/cli/build.ts` generates — the workspace
manifests all stay private.

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
   - `npm publish --provenance --access public` from `packages/cli/dist`
     (needs the `NPM_TOKEN` repository secret — see the workflow header),
   - creates the GitHub release with the tarball attached.

5. **Verify**: `bunx velloo@X.Y.Z --version` from a scratch directory.

## Local dry run

```bash
bun packages/cli/build.ts        # builds dist/ + packs velloo-X.Y.Z.tgz
cd "$(mktemp -d)" && bun init -y && bun add /path/to/velloo/velloo-X.Y.Z.tgz
./node_modules/.bin/velloo --help
```

`bun run cli:install` installs the same artifact globally (localhost cloud
default); `bun run cli:prod` bakes the hosted cloud URL like the release build,
and `bun run cli:dev` bakes the dev environment (`https://api.dev.velloo.ai`).

## Dogfood channel

`bun run cli:release` (prod) / `bun run cli:release:dev` build the bundle with
the environment's cloud URL baked in and upload `install.sh` + the tarball to
that environment's R2 bucket under `downloads/` — velloo-cloud serves them at
`get.velloo.dev` / `get.dev.velloo.dev`. Credentials come from the sibling
velloo-cloud checkout's `.env.prod` / `.env.dev` (override the checkout with
`VELLOO_CLOUD_DIR`, or pass `BLOB_*` directly).
