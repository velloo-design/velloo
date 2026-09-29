/**
 * A design that shows the app without the app: each live `HtmlFragment` on a
 * screen is captured through the daemon's own proxy (and so its signed-in
 * session) and replaced by the design's own editable `Html` nodes, which
 * remember the route they came from. A snapshot again re-captures from that
 * route. Anyone who opens the design later — a fresh clone, no app running,
 * never signed in — sees the page as it was captured.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FrameworkAdapter } from "@velloo/provider";
import { captureScreenshot, type HostRuntimeState } from "@velloo/renderer";
import { err, ok, type Result } from "@velloo/result";
import { isComponentNode, type Node, type Screen } from "@velloo/schema";
import { shipHostFiles } from "./host-files.ts";
import type { CanvasBundler } from "./live/canvas-bundler.ts";
import type { LiveBundler } from "./live/component-bundler.ts";
import {
  defaultViewport,
  makeCanvasBundle,
  makeLiveUrl,
  renderForCapture,
} from "./mcp/tools/screenshot-helpers.ts";
import { setScreenTree } from "./mutations/api/screens.ts";
import type { MutationContext } from "./mutations/context.ts";
import { providerForScreen } from "./mutations/lookup.ts";
import { HostSession } from "./routes/host-session.ts";
import { localHostOrigin } from "./routes/html-host.ts";
import type { TailwindJit } from "./styles/tailwind-jit.ts";

export interface SnapshotDeps {
  jit: TailwindJit;
  bundler: LiveBundler;
  canvasBundler: CanvasBundler;
  /** The daemon's own origin, which the headless page loads the app through. */
  assetOrigin: string | undefined;
}

export interface SnapshotResult {
  screenId: string;
  /** Fragments captured and now the design's own nodes. */
  snapshots: number;
  warnings: string[];
}

/** Where a snapshot keeps the app's files, in the design: served when the app isn't there. */
const HOST_FILES_DIR = join("assets", "host");

/** The design's stored copy of the host file at `hostPath`, if it keeps one. */
export function storedHostFile(root: string, hostPath: string): string | undefined {
  const parts = hostPath.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === ".." || part === ".")) return undefined;
  const file = join(root, HOST_FILES_DIR, ...parts);
  return existsSync(file) ? file : undefined;
}

/**
 * Keep the app's own files a snapshot needs — its stylesheets (and what they
 * `url()`), the images the tree shows — in the design at `assets/host/<path>`,
 * fetched with the app session so files behind a sign-in come too. The proxy
 * serves them whenever the app isn't reachable, so a snapshot looks the same
 * with no app at all.
 */
export async function storeHostFiles(opts: {
  root: string;
  origin: URL;
  stylesheets: string[];
  screen: Screen;
  session: HostSession;
}): Promise<string[]> {
  const warnings: string[] = [];
  const cookie = opts.session.header();
  const { files } = await shipHostFiles({
    origin: opts.origin,
    stylesheets: opts.stylesheets,
    screens: [opts.screen],
    snippets: [],
    warn: (message) => warnings.push(message),
    fetch: ((input: string | URL | Request, init?: RequestInit) =>
      fetch(input, { ...init, headers: cookie ? { cookie } : {} })) as typeof fetch,
  });
  for (const file of files) {
    const target = join(opts.root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
  return warnings;
}

/**
 * Why a capture can't become the design, or undefined when it can: a sign-in
 * page, an error or a half-loaded page would be committed as the page itself.
 */
export function snapshotRefusal(
  host: HostRuntimeState | undefined,
  origin: URL,
): string | undefined {
  const failures = host?.failures ?? [];
  if (failures.length === 0 && host?.settled !== false) return undefined;
  const redirected = failures.find((failure) => failure.startsWith("redirected "));
  if (redirected) {
    return `The app answered with a different page (${redirected}) — usually its sign-in. Sign in once in a Preview of this screen (the canvas keeps that session), then snapshot again.`;
  }
  return failures.length > 0
    ? `The app didn't serve everything (${failures.join(", ")}). Check it's running at ${origin.origin}.`
    : "The app's pages were still loading when the capture timed out.";
}

export function countFragments(node: Node): number {
  if (!isComponentNode(node)) return 0;
  const own = node.$ref === "HtmlFragment" ? 1 : 0;
  return own + (node.children ?? []).reduce((sum, child) => sum + countFragments(child), 0);
}

export async function snapshotFromApp(
  ctx: MutationContext,
  deps: SnapshotDeps,
  screenId: string,
): Promise<Result<SnapshotResult, string>> {
  const screen = ctx.folder.screens.get(screenId);
  if (!screen) return err(`No screen "${screenId}".`);
  const adapter = providerForScreen(ctx, screen) as FrameworkAdapter;
  if (!adapter.staticSnapshot || !adapter.liveAgain) {
    return err(`Screen "${screenId}" isn't an HTML design; there is no app page to snapshot.`);
  }
  const origin = localHostOrigin(ctx.folder.config.hostApp?.previewUrl);
  if (!origin) {
    return err(
      "Set hostApp.previewUrl in .design/config.json to the running app's local origin, then snapshot again.",
    );
  }
  const before = JSON.stringify(screen.tree);
  const live = adapter.liveAgain(screen.tree);
  const fragments = countFragments(live);
  if (fragments === 0) {
    return err(
      `Screen "${screenId}" has no HtmlFragment or earlier snapshot; there is nothing to capture from the app.`,
    );
  }
  const theme = ctx.folder.theme;
  const html = await renderForCapture(
    ctx,
    { ...screen, tree: live },
    {
      theme,
      dark: false,
      viewport: defaultViewport(ctx.folder),
      snapshotCss: await deps.jit.build(),
      liveUrl: makeLiveUrl(ctx, deps.bundler),
      canvasBundle: makeCanvasBundle(ctx, deps.canvasBundler),
      assetOrigin: deps.assetOrigin,
    },
  );
  const capture = await captureScreenshot({
    html,
    viewport: defaultViewport(ctx.folder),
    hostFragments: true,
  });
  const refused = snapshotRefusal(capture.host, origin);
  if (refused) return err(`Nothing was changed. ${refused}`);
  const frozen = adapter.staticSnapshot(live, capture.hostFragments ?? [], { editable: true });
  // The capture takes seconds; an edit that landed meanwhile wins.
  if (JSON.stringify(ctx.folder.screens.get(screenId)?.tree) !== before) {
    return err(`Screen "${screenId}" changed while it was being captured; snapshot again.`);
  }
  const written = await setScreenTree(ctx, { screenId, tree: frozen.tree });
  if (!written.ok) return err(`Couldn't write the snapshot: ${JSON.stringify(written.error)}`);
  const { root, config } = ctx.folder;
  const fileWarnings = await storeHostFiles({
    root,
    origin,
    stylesheets: config.hostApp?.stylesheets ?? [],
    screen: { ...screen, tree: frozen.tree },
    session: HostSession.forFolder(root, origin.origin, config.folderId),
  });
  return ok({ screenId, snapshots: fragments, warnings: [...frozen.warnings, ...fileWarnings] });
}
