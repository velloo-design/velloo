import pkg from "../package.json" with { type: "json" };

/**
 * The build stamp, baked at build time via Bun.build `define` (see
 * packages/cli/build.ts). A stable release is its bare version; the `dev` and
 * `local` channels append `(<short-sha>[-dirty] · <build-date>)` because their
 * version alone doesn't name a commit. A from-source run (`bun run velloo`,
 * no define) falls back to the package version. `typeof` is safe when the
 * identifier was never defined.
 */
declare const __VELLOO_BUILD_VERSION__: string;

/**
 * Epoch ms the bundle was built. The local release channel has no version to
 * compare — every `cli:build` of a branch is the same `0.1.0` — so this is
 * what orders one local build against another.
 */
declare const __VELLOO_BUILD_TIME__: number;

export const PACKAGE_VERSION: string = pkg.version;
export const TOOL_VERSION: string =
  typeof __VELLOO_BUILD_VERSION__ === "string" ? __VELLOO_BUILD_VERSION__ : PACKAGE_VERSION;
export const BUILD_TIME_MS: number | undefined =
  typeof __VELLOO_BUILD_TIME__ === "number" ? __VELLOO_BUILD_TIME__ : undefined;
