import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { captureScreenshot, closePooledBrowser, renderScreen } from "@velloo/renderer";
import type { Screen, Theme, Viewport } from "@velloo/schema";
import {
  extraThemeBlock,
  findHostTailwindConfig,
  LiveBundler,
  liveExtensions,
  loadDesignFolder,
  orderedBoards,
  registryForScreen,
  renderPassForScreen,
  resolveProviders,
  TailwindJit,
  writeJsonAtomic,
} from "@velloo/server";
import { defineCommand } from "citty";
import { withAssetServer } from "../asset-server.ts";
import { defaultCloudUrl } from "../cloud.ts";
import { loadCredential } from "../cloud-credentials.ts";
import {
  CloudUnreachableError,
  type LinkUploadOutcome,
  uploadLinkBundle,
} from "../cloud-upload.ts";
import { fail } from "../fail.ts";
import { pickBoards, resolveDesignFolder } from "../folder.ts";
import { type BundleScreenshots, captureBundleScreenshots } from "../publish-screenshots.ts";

/**
 * The folder's stable cloud identity (config.json `folderId`). Pre-folderId
 * folders get one on their first publish — written back through the raw file
 * (not the parsed Config) so unknown fields survive the round-trip.
 */
async function ensureFolderId(folder: string, existing: string | undefined): Promise<string> {
  if (existing) return existing;
  const path = join(folder, ".design", "config.json");
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const folderId = crypto.randomUUID();
  await writeJsonAtomic(path, { ...raw, folderId });
  console.log(
    `  assigned this folder a cloud id (.design/config.json folderId) — commit it so every clone finds the folder's share links.`,
  );
  return folderId;
}

function gitCommitSha(folder: string): string | null {
  try {
    const dirty = execFileSync("git", ["-C", folder, "status", "--porcelain"], {
      encoding: "utf8",
    });
    if (dirty.trim().length > 0) return null;
    return execFileSync("git", ["-C", folder, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Normalize a git remote URL to `host/owner/repo` for display on the share
 * card: `git@github.com:owner/repo.git`, `ssh://git@host/owner/repo`, and
 * `https://host/owner/repo.git` all collapse to the same form. Null when the
 * URL doesn't look like a hosted remote (e.g. a local path).
 */
function normalizeRemote(url: string): string | null {
  const rest = url.trim().replace(/\.git\/?$/, "");
  // scp-like syntax: [user@]host:path (no scheme).
  const scp = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/.exec(rest);
  if (scp?.[1] && scp[2]) return `${scp[1]}/${scp[2].replace(/^\/+/, "")}`;
  try {
    const parsed = new URL(rest.includes("://") ? rest : `https://${rest}`);
    if (!parsed.hostname || !parsed.pathname || parsed.pathname === "/") return null;
    return `${parsed.hostname}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

/**
 * Where this publish came from, for the share card: the origin remote
 * (normalized to host/owner/repo) and the current branch. Best-effort — a
 * non-git folder, detached HEAD, or missing remote publishes without them.
 */
function gitContext(folder: string): { repo: string | null; branch: string | null } {
  const run = (args: string[]): string | null => {
    try {
      return execFileSync("git", ["-C", folder, ...args], { encoding: "utf8" }).trim() || null;
    } catch {
      return null;
    }
  };
  const branchRaw = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  const remote = run(["remote", "get-url", "origin"]);
  return {
    repo: remote ? normalizeRemote(remote) : null,
    branch: branchRaw === "HEAD" ? null : branchRaw, // "HEAD" = detached
  };
}

export default defineCommand({
  meta: {
    name: "publish",
    description: "Publish the design folder as a velloo-cloud share link (the cloud renders it)",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: "Design folder (default: ./velloo)",
    },
    url: {
      type: "string",
      description: "velloo-cloud base URL (default: $VELLOO_CLOUD_URL or the built-in default)",
    },
    token: {
      type: "string",
      description: "velloo-cloud access token (default: $VELLOO_CLOUD_TOKEN)",
    },
    slug: {
      type: "string",
      description: "Reuse/choose the link slug (default: server-generated)",
    },
    title: {
      type: "string",
      description: "Link title (default: folder name)",
    },
    boards: {
      type: "string",
      description: "Comma-separated board ids to publish (default: pick interactively / all)",
    },
    visibility: {
      type: "string",
      description: "public | private (default: public)",
    },
    w: { type: "string", description: "Viewport width in px (default: 1440)" },
    h: { type: "string", description: "Viewport height in px (default: 900)" },
    screenshots: {
      type: "boolean",
      default: true,
      description: "Capture PNG previews into the bundle (--no-screenshots to skip)",
    },
  },
  async run({ args }) {
    const folder = await resolveDesignFolder(args.folder, "publish");
    const baseUrl = args.url ? args.url.replace(/\/+$/, "") : defaultCloudUrl();
    const token =
      args.token ?? process.env.VELLOO_CLOUD_TOKEN ?? (await loadCredential(baseUrl))?.token;
    if (!token) {
      fail("publish", "not logged in. Run `velloo login` (or pass --token / VELLOO_CLOUD_TOKEN).");
    }
    const visibility = args.visibility ?? "public";
    if (visibility !== "public" && visibility !== "private") {
      fail("publish", `--visibility must be 'public' or 'private', got '${visibility}'`);
    }
    const viewport: Viewport = {
      w: args.w ? Number(args.w) : 1440,
      h: args.h ? Number(args.h) : 900,
    };

    const design = await loadDesignFolder(folder);
    if (design.screens.size === 0) {
      fail("publish", `no screens found in ${folder} — is this a velloo design folder?`);
    }

    // Publish whole boards: pick which (interactive multiselect, all preselected;
    // or --boards a,b), then export those boards + every screen they place. A
    // folder with no boards publishes all its screens (selected = []).
    const interactive = Boolean(process.stdin.isTTY);
    const selected = await pickBoards(folder, args.boards, interactive, "publish");
    const selectedIds = new Set(selected.map((b) => b.id));
    // Ship boards in the canvas sidebar's display order (config.boardOrder)
    // so the cloud viewer's board switcher matches what the designer sees.
    const allBoards = orderedBoards(design).map(([, b]) => b);
    const boards = selected.length ? allBoards.filter((b) => selectedIds.has(b.id)) : allBoards;
    const screenIds = selected.length
      ? new Set(boards.flatMap((b) => b.frames.map((f) => f.screen)))
      : null; // null ⇒ all screens (board-less folder)
    const screens = screenIds
      ? [...design.screens.values()].filter((s) => screenIds.has(s.id))
      : [...design.screens.values()];
    if (screens.length === 0) fail("publish", "the selected boards have no screens.");

    // loadDesignFolder guarantees a schema-v2 config (older folders are
    // refused with a `velloo upgrade` hint), so no migration happens here.
    const config = design.config;
    const { providers, defaultProvider } = await resolveProviders(config, folder);

    // Live-island bundle: when the folder declares render:"live" extensions
    // (charts &c.), compile the host app's real components into one ESM module.
    // The cloud's screen viewer imports it and client-mounts the real component
    // into its marker. No live extensions ⇒ no bundler, no bundle.js.
    const liveExt = liveExtensions(config.extensions);
    const bundler =
      Object.keys(liveExt).length > 0
        ? new LiveBundler(
            folder,
            () => config,
            () => liveExt,
            true,
            // Publish ships one bundle.js file — multi-app folders inline
            // each app bundle as a data-URL import instead of sibling routes.
            true,
          )
        : null;

    // Compile Tailwind once for the whole folder. The cloud serves this CSS as-is
    // and never runs Tailwind, so it must include everything the screens use —
    // crucially the theme's palette/font utilities (`bg-ink`, `bg-amber`,
    // `font-display`), which only compile when the theme's @theme block is fed in
    // (same as the dev canvas). Host live components carry their own classes too.
    const jit = new TailwindJit(
      Object.values(providers),
      join(folder, "screens"),
      undefined,
      () => extraThemeBlock(design),
      bundler ? () => bundler.hostSourceDirs() : undefined,
      () => findHostTailwindConfig(folder, config.hostApp),
      config.styling?.framework,
    );
    const snapshotCss = await jit.build();

    const title = args.title ?? `${folder.split("/").filter(Boolean).pop()} designs`;
    const form = new FormData();

    let live = false;
    let liveCode: string | null = null;
    if (bundler) {
      const bundle = await bundler.build();
      for (const e of bundle.errors) console.log(`  live-island warning: ${e.message}`);
      form.append("file", new File([bundle.code], "bundle.js", { type: "text/javascript" }));
      liveCode = bundle.code;
      live = true;
    }

    // PNG previews (one per screen, one composite per board, plus a cover) —
    // captured through the same renderScreen → captureScreenshot pipeline the
    // MCP `screenshot` tool uses. Never fatal: no browser (or --no-screenshots)
    // publishes without them.
    let shots: BundleScreenshots | null = null;
    if (args.screenshots !== false) {
      try {
        shots = await withAssetServer(folder, liveCode, (baseHref) => {
          const htmlCache = new Map<string, string>();
          const renderHtml = async (screen: Screen, themeName?: string): Promise<string> => {
            const theme: Theme =
              (themeName ? design.themes.get(themeName) : undefined) ?? design.theme;
            const key = `${screen.id} ${theme.name}`;
            const cached = htmlCache.get(key);
            if (cached) return cached;
            const { html } = await renderScreen(screen, theme, {
              viewport,
              snapshotCss,
              registry: registryForScreen(
                screen,
                providers,
                defaultProvider,
                config.extensions ?? {},
              ),
              renderPass: renderPassForScreen(screen, providers, defaultProvider, theme),
              snippets: design.snippets,
              customCss: design.customCss,
              baseHref,
              ...(live ? { liveBundleUrl: "/live/bundle.js" } : {}),
            });
            htmlCache.set(key, html);
            return html;
          };
          return captureBundleScreenshots({
            screens,
            boards,
            viewport,
            renderHtml,
            capture: async (req) =>
              (
                await captureScreenshot({
                  html: req.html,
                  viewport: req.viewport,
                  fullPage: req.fullPage,
                  deviceScaleFactor: req.deviceScaleFactor,
                })
              ).png,
            warn: (m) => console.log(`  ${m}`),
          });
        });
      } finally {
        // Release the shared Chromium — publish is a one-shot process, and an
        // open browser connection would keep it alive after the upload.
        await closePooledBrowser();
      }
      for (const f of shots?.files ?? []) {
        form.append("file", new File([f.bytes], f.path, { type: "image/png" }));
      }
    }

    // Designer markup travels with the design so the cloud's board canvas can
    // draw it: node-anchored annotations for the published screens, free
    // notes for the published boards. Only non-empty sidecars ship.
    const annotations = Object.fromEntries(
      [...design.annotations].filter(
        ([screenId, list]) => list.length > 0 && screens.some((s) => s.id === screenId),
      ),
    );
    const notes = Object.fromEntries(
      [...design.notes].filter(
        ([boardId, list]) => list.length > 0 && boards.some((b) => b.id === boardId),
      ),
    );

    // The design model the cloud renders from: raw screen trees + boards + theme
    // + snippets + annotations/notes + the slice of config needed to rebuild the
    // component registry. No HTML and no gallery — the cloud owns the frame.
    const designDoc = {
      version: 1 as const,
      title,
      viewport,
      defaultLibrary: config.defaultLibrary,
      libraries: config.libraries,
      extensions: config.extensions ?? {},
      viewportPresets: config.viewportPresets ?? [],
      theme: design.theme,
      themes: Object.fromEntries(design.themes),
      customCss: design.customCss,
      snippets: [...design.snippets.values()],
      screens,
      boards,
      annotations,
      notes,
      live,
      snapshotCssPath: "snapshot.css",
      ...(live ? { bundlePath: "bundle.js" } : {}),
      ...(shots ? { screenshots: shots.manifest } : {}),
    };
    form.append(
      "file",
      new File([JSON.stringify(designDoc)], "design.json", { type: "application/json" }),
    );
    form.append("file", new File([snapshotCss], "snapshot.css", { type: "text/css" }));

    // Upload the image assets the published screens reference (absolute
    // `/assets/…` paths). Only referenced files travel — keeps the publish lean
    // and within the size limit; the cloud serves them under /s/<slug>/assets/.
    const assetRefs = new Set<string>();
    const assetRe = /\/assets\/[A-Za-z0-9._@\-/]+/g;
    for (const s of screens) {
      for (const m of JSON.stringify(s).matchAll(assetRe)) assetRefs.add(m[0]);
    }
    for (const ref of assetRefs) {
      const rel = ref.replace(/^\//, ""); // assets/foo.png
      try {
        const bytes = await readFile(join(folder, rel));
        form.append("file", new File([bytes], rel));
      } catch {
        console.log(`  asset not found: ${rel}`);
      }
    }

    const commitSha = gitCommitSha(folder);
    if (commitSha) form.append("commitSha", commitSha);
    // Repo + branch provenance for the share card. Unlike commitSha these
    // travel even from a dirty tree — they name where the design lives, not
    // an exact state.
    const git = gitContext(folder);
    if (git.repo) form.append("gitRepo", git.repo);
    if (git.branch) form.append("gitBranch", git.branch);

    // The folder's cloud identity — the cloud reuses the folder's existing
    // link (200) or creates one carrying it (201).
    const folderId = await ensureFolderId(folder, design.config.folderId);

    let upload: LinkUploadOutcome;
    try {
      upload = await uploadLinkBundle({
        baseUrl,
        token,
        link: {
          ...(args.slug ? { slug: args.slug } : {}),
          folderId,
          title,
          visibility,
        },
        form,
      });
    } catch (error) {
      if (error instanceof CloudUnreachableError) {
        fail(
          "publish",
          `cannot reach ${baseUrl} (${error.message}). Is velloo-cloud up? (bun cloud:up)`,
        );
      }
      fail("publish", error instanceof Error ? error.message : String(error));
    }

    const shareLink = upload.shareUrl;
    const key = upload.link.accessToken ? `?k=${upload.link.accessToken}` : "";

    console.log(
      `velloo publish: ${upload.files} files, ${Math.round(upload.bytes / 1024)} KB${shots ? `, ${shots.files.length} screenshots` : ""}${commitSha ? `, commit ${commitSha.slice(0, 7)}` : ""}`,
    );
    console.log(`  ${shareLink}${key}`);
    // Version-history messaging (folderId-aware clouds only). The share URL is
    // stable now, so a re-publish REPLACES what viewers see: free keeps only
    // the latest version, paid tiers retain every publish for pinning.
    const history = upload.history;
    if (history && !history.retained && history.pruned > 0) {
      console.log("  replaced the previous version — the free plan keeps only the latest.");
      console.log(
        "  Upgrade to Pro to keep version history and revisit any past publish: https://velloo.ai/pricing",
      );
    } else if (history?.retained && history.versions > 1) {
      console.log(
        `  history: ${history.versions} versions kept — pin any of them from ${shareLink}v/<version>/`,
      );
    }
  },
});
