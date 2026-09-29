import { join } from "node:path";
import type { FrameworkAdapter } from "@velloo/provider";
import { captureScreenshot, closePooledBrowser, renderScreen } from "@velloo/renderer";
import {
  countFragments,
  HostSession,
  hostRuntimeForScreen,
  hostRuntimeScript,
  htmlHostFetch,
  localHostOrigin,
  providerForScreen,
  registryForScreen,
  renderPassForScreen,
  snapshotRefusal,
  storeHostFiles,
  writeJsonAtomic,
} from "@velloo/server";
import { withAssetServer } from "../asset-server.ts";
import { loadPipeline } from "../ci/render.ts";

export interface SnapshotReport {
  /** Screens now showing the app's pages as the design's own nodes. */
  taken: string[];
  /** Screens left live, with why. */
  kept: { screenId: string; reason: string }[];
}

/**
 * Capture every live fragment in a new HTML design from the running app, so
 * the design shows its pages to whoever opens it next without the app — what
 * `snapshot_from_app` does per screen in the daemon. A screen the app won't
 * serve as asked (a sign-in redirect, an error) stays live and says why.
 * Needs a headless browser; without one, nothing changes.
 */
export async function snapshotScreens(folder: string): Promise<SnapshotReport> {
  const report: SnapshotReport = { taken: [], kept: [] };
  const pipeline = await loadPipeline(folder);
  const { design, config, providers, defaultProvider, snapshotCss } = pipeline;
  const origin = localHostOrigin(config.hostApp?.previewUrl);
  if (!origin) return report;
  const viewport = config.viewportPresets.find((p) => /desktop/i.test(p.name)) ?? {
    w: 1440,
    h: 900,
  };
  const host = htmlHostFetch({
    hostApp: () => config.hostApp,
    runtimeScript: () => hostRuntimeScript(Object.values(providers)),
    sessionFor: (at) => HostSession.forFolder(folder, at, config.folderId),
  });
  try {
    await withAssetServer(
      folder,
      null,
      async (baseHref) => {
        for (const screen of design.screens.values()) {
          const adapter = providerForScreen(screen, providers, defaultProvider) as FrameworkAdapter;
          if (!adapter.staticSnapshot || !adapter.liveAgain) continue;
          const live = adapter.liveAgain(screen.tree);
          if (countFragments(live) === 0) continue;
          const liveScreen = { ...screen, tree: live };
          const { html } = await renderScreen(liveScreen, design.theme, {
            viewport,
            snapshotCss,
            registry: registryForScreen(
              liveScreen,
              providers,
              defaultProvider,
              config.extensions ?? {},
              config.styling?.framework,
            ),
            renderPass: renderPassForScreen(liveScreen, providers, defaultProvider, design.theme),
            snippets: design.snippets,
            customCss: design.customCss,
            baseHref,
            hostRuntime: hostRuntimeForScreen(
              liveScreen,
              providers,
              defaultProvider,
              config.hostApp,
            ),
          });
          const capture = await captureScreenshot({ html, viewport, hostFragments: true });
          const refused = snapshotRefusal(capture.host, origin);
          if (refused) {
            report.kept.push({ screenId: screen.id, reason: refused });
            continue;
          }
          const frozen = adapter.staticSnapshot(live, capture.hostFragments ?? [], {
            editable: true,
          });
          const snapshot = { ...screen, tree: frozen.tree };
          await writeJsonAtomic(join(folder, "screens", `${screen.id}.json`), snapshot);
          await storeHostFiles({
            root: folder,
            origin,
            stylesheets: config.hostApp?.stylesheets ?? [],
            screen: snapshot,
            session: HostSession.forFolder(folder, origin.origin, config.folderId),
          });
          report.taken.push(screen.id);
        }
      },
      { host },
    );
  } finally {
    await closePooledBrowser();
  }
  return report;
}
