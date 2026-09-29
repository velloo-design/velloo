import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FrameworkAdapter } from "@velloo/provider";
import { captureDir, isSafeCaptureId, readCaptureManifest } from "@velloo/renderer";
import { err, ok, type Result } from "@velloo/result";
import { HostAppSchema, type Screen, type Snippet } from "@velloo/schema";
import { appSourceHostFiles, captureHostSource } from "../host-file-sources.ts";
import { type HostFileSource, shipHostFiles } from "../host-files.ts";
import { hostAppRootFrom } from "../live/bundle-core.ts";
import { localDesignOf } from "../project-location.ts";
import type { MutationContext } from "./context.ts";
import { badRequest, type MutationError } from "./errors.ts";
import { persistConfig } from "./persist.ts";

export interface StoreHostFilesArgs {
  /** `"source"`: the app's files on disk. `{ captureId }`: a page captured from the running app. */
  from: "source" | { captureId: string };
  /**
   * The app's stylesheets, in cascade order (root-relative paths or https
   * URLs). Absent ⇒ the ones the captured page linked, else the configured ones.
   */
  stylesheets?: string[] | undefined;
}

export interface StoreHostFilesResult {
  stylesheets: string[];
  /** Design-relative paths written, `assets/host/…`. */
  stored: string[];
  warnings: string[];
}

/**
 * Read the host files `stylesheets`, `screens` and `snippets` reference from
 * `source` and write them into the design at `root`, under `assets/host/`.
 */
export async function writeHostFiles(opts: {
  root: string;
  source: HostFileSource;
  stylesheets: string[];
  screens: Screen[];
  snippets: Snippet[];
}): Promise<{ stored: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const { files } = await shipHostFiles({
    source: opts.source,
    stylesheets: opts.stylesheets,
    screens: opts.screens,
    snippets: opts.snippets,
    warn: (message) => warnings.push(message),
  });
  for (const file of files) {
    const target = join(opts.root, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.bytes);
  }
  return { stored: files.map((file) => file.path), warnings };
}

/**
 * Keep copies of the app's own files in the design — its stylesheets, what
 * they `url()`, and the images its trees name by app path — so it looks the
 * same to everyone who opens it, with no app running. Read from the app's
 * source or from a capture, never from the running app; a later call replaces
 * copies of the same path and leaves the rest.
 */
export async function storeHostFiles(
  ctx: MutationContext,
  args: StoreHostFilesArgs,
): Promise<Result<StoreHostFilesResult, MutationError>> {
  if (!Object.values(ctx.providers).some((p) => (p as FrameworkAdapter).hostStylesheets)) {
    return err(badRequest("Only an HTML design is styled by the app's own files."));
  }
  const { root, config } = ctx.folder;
  let source: HostFileSource;
  let linked: string[] = [];
  if (args.from === "source") {
    source = appSourceHostFiles(hostAppRootFrom(root, config.hostApp), [root]);
  } else {
    const { captureId } = args.from;
    const manifest = isSafeCaptureId(captureId)
      ? readCaptureManifest(root, captureId, config.folderId)
      : null;
    if (!manifest) return err(badRequest(`No capture "${captureId}" — call list_captures.`));
    const capture = await captureHostSource(
      captureDir(root, captureId, config.folderId),
      manifest.finalUrl ?? manifest.url,
    );
    source = capture;
    linked = capture.stylesheets;
  }

  const requested =
    args.stylesheets ?? (linked.length > 0 ? linked : (config.hostApp?.stylesheets ?? []));
  const parsed = HostAppSchema.shape.stylesheets.safeParse(requested);
  if (!parsed.success) {
    return err(
      badRequest("A stylesheet is a root-relative path (/static/site.css) or an https URL."),
    );
  }
  const stylesheets = parsed.data ?? [];

  const { stored, warnings } = await writeHostFiles({
    root,
    source,
    stylesheets,
    screens: [...ctx.folder.screens.values()],
    snippets: [...ctx.folder.snippets.values()],
  });

  const current = config.hostApp?.stylesheets ?? [];
  if (JSON.stringify(current) !== JSON.stringify(stylesheets)) {
    await persistConfig(ctx.folder, {
      ...config,
      // No `hostApp` yet means the default root, which is what `app:.`
      // resolves to for a design outside the checkout and `..` inside it.
      hostApp: {
        ...(config.hostApp ?? { root: localDesignOf(root) ? "app:." : ".." }),
        stylesheets,
      },
    });
  }
  // The frames re-render on it, which is how they pick up the new copies.
  ctx.broadcast({ type: "config-changed" });
  return ok({ stylesheets, stored, warnings });
}
