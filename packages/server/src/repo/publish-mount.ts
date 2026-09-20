import { type ComponentProvider, type FrameworkAdapter, styleChannelOf } from "@velloo/provider";
import type { Screen, Theme } from "@velloo/schema";
import type { DesignFolder } from "../design-folder.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { makeCanvasBundle } from "../mcp/tools/screenshot-helpers.ts";
import type { MutationContext } from "../mutations/context.ts";
import { createRepoComponents } from "./store.ts";

/**
 * Publish previews for screens that use the app's own components. Those are
 * captured here, on the user's machine, with the real components mounted — the
 * PNG is the safe artifact the cloud receives. The cloud never runs repository
 * code: its viewer draws the same nodes from the design JSON as proxies. Other
 * screens keep publish's plain server render.
 */
export function createPublishMount(
  folder: DesignFolder,
  providers: Record<string, ComponentProvider>,
  defaultProvider: ComponentProvider,
): {
  forScreen(
    screen: Screen,
    theme: Theme,
    dark: boolean,
  ): Promise<
    | { url: string; themeOptions: unknown; preview?: unknown; staticRefs?: string[] | undefined }
    | undefined
  >;
  /** Answer a capture page's bundle request; null for any other path. */
  serve(url: URL): Promise<string | null>;
} {
  const repo = createRepoComponents(folder, providers);
  const bundler = new CanvasBundler(
    folder.root,
    () => folder.config.hostApp,
    (libraryId) => (providers[libraryId] as FrameworkAdapter | undefined)?.canvasBundleSpec,
    true,
    {
      repo,
      channelFor: (libraryId) => {
        const provider = providers[libraryId];
        return provider
          ? styleChannelOf(provider, folder.config.styling?.framework).kind
          : undefined;
      },
    },
  );
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
      return mount &&
        new URL(mount.url, "http://publish.local").searchParams.get("refs")?.includes("repo:")
        ? mount
        : undefined;
    },
    async serve(url) {
      if (url.pathname !== "/api/canvas/bundle.js") return null;
      const lib = url.searchParams.get("lib") ?? folder.config.defaultLibrary;
      const refs = (url.searchParams.get("refs") ?? "").split(",").filter(Boolean);
      return (await bundler.build(lib, refs)).code;
    },
  };
}
