import type { ComponentProvider } from "@velloo/provider";
import type { Screen } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { type CanvasBundleFor, folderCanvasBundler } from "../live/canvas-bundler.ts";
import { makeCanvasBundle, mountDiagnostics } from "../mcp/tools/screenshot-helpers.ts";
import type { MutationContext } from "../mutations/context.ts";
import { appStylesheetFor } from "./app-stylesheet.ts";
import { createRepoComponents } from "./store.ts";

/**
 * The client mount for a capture taken outside the daemon — `velloo export`,
 * `velloo render`, publish previews. The daemon's routes hand captures a
 * `canvasBundleFor` and serve the bundle themselves; a one-shot CLI has
 * neither, and without this its PNG shows proxies where the canvas shows the
 * app's real components. `serve` answers the capture page's bundle request
 * through the CLI's own asset server.
 *
 * Publish adds `onlyRepository`: its previews are the artifact the cloud
 * receives, and a screen with no repository component already server-renders
 * faithfully, so paying for a bundle per screen buys nothing there. The cloud
 * never runs repository code either way — its viewer draws the same nodes from
 * the design JSON as proxies.
 */
export function createCaptureMount(
  folder: DesignFolder,
  providers: Record<string, ComponentProvider>,
  defaultProvider: ComponentProvider,
  opts: { onlyRepository?: boolean } = {},
): {
  forScreen: CanvasBundleFor;
  /** The app's global CSS for a screen (see `appStylesheetFor`). */
  appCss(screen: Screen): Promise<string>;
  /** Why the screen's client mount didn't take, in words; empty when it did. */
  problems(screen: Screen): Promise<string[]>;
  /** Answer a capture page's bundle request; null for any other path. */
  serve(url: URL): Promise<string | null>;
  /**
   * Host source dirs the mounted components come from, for the Tailwind JIT to
   * scan — a class used only inside the app's own component compiles nowhere
   * else, and the capture would mount it unstyled.
   */
  sourceDirs(): string[];
} {
  const repo = createRepoComponents(folder, providers);
  const bundler = folderCanvasBundler(folder, providers, repo, true);
  const ctx: MutationContext = {
    folder,
    providers,
    defaultProvider,
    canvasBundler: bundler,
    repo,
    broadcast: () => undefined,
  };
  const canvasFor = makeCanvasBundle(ctx, bundler);
  return {
    async forScreen(screen, theme, dark) {
      const mount = await canvasFor(screen, theme, dark);
      if (!mount || !opts.onlyRepository) return mount;
      return new URL(mount.url, "http://capture.local").searchParams.get("refs")?.includes("repo:")
        ? mount
        : undefined;
    },
    appCss: (screen) => appStylesheetFor(repo, screen.tree),
    problems: async (screen) =>
      (await mountDiagnostics(ctx, bundler, screen)).map((entry) => entry.message),
    sourceDirs: () => bundler.sourceDirs(Object.keys(providers)),
    async serve(url) {
      if (url.pathname !== "/api/canvas/bundle.js") return null;
      const lib = url.searchParams.get("lib") ?? folder.config.defaultLibrary;
      const refs = (url.searchParams.get("refs") ?? "").split(",").filter(Boolean);
      return (await bundler.build(lib, refs)).code;
    },
  };
}
