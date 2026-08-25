import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { HostApp } from "@velloo/schema";
import { hostAppRootFrom } from "../live/bundle-core.ts";

const CONFIG_NAMES = [
  "tailwind.config.ts",
  "tailwind.config.js",
  "tailwind.config.cjs",
  "tailwind.config.mjs",
];

/**
 * Locate the host app's legacy (Tailwind v3-style) config, if any.
 *
 * The canvas compiles with Tailwind v4, which ignores v3 JS/TS config — so layout
 * concerns the user's app encodes there (`container: { center, padding, screens }`,
 * custom `screens` breakpoints, plugins) silently don't apply, and a faithfully-copied
 * `container` renders flush-left instead of centered. Feeding the config path back through
 * v4's `@config` compat directive restores that behavior. velloo's own `@theme` tokens stay
 * authoritative (CSS `@theme` wins over the JS config), so this honors the app's *layout*
 * without letting its theme override velloo's palette. Returns an absolute path or null.
 */
export function findHostTailwindConfig(
  folderRoot: string,
  hostApp: HostApp | undefined,
): string | null {
  const root = hostAppRootFrom(folderRoot, hostApp);
  for (const name of CONFIG_NAMES) {
    const path = resolve(root, name);
    if (existsSync(path)) return path;
  }
  return null;
}
