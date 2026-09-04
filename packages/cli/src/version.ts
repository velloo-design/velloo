import pkg from "../package.json" with { type: "json" };

/**
 * The build stamp, baked at build time via Bun.build `define` (see
 * packages/cli/build.ts) as `<version> (<short-sha>[-dirty] · <build-date>)`.
 * A from-source run (`bun run velloo`, no define) falls back to the bare
 * package version. `typeof` is safe when the identifier was never defined.
 */
declare const __VELLOO_BUILD_VERSION__: string;

export const PACKAGE_VERSION: string = pkg.version;
export const TOOL_VERSION: string =
  typeof __VELLOO_BUILD_VERSION__ === "string" ? __VELLOO_BUILD_VERSION__ : PACKAGE_VERSION;
