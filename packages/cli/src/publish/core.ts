import { type ExecFileSyncOptionsWithStringEncoding, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  DESIGN_BUNDLE_FORMAT,
  type DesignBundle,
  DesignBundleSchema,
} from "@velloo/protocol/publish";
import type { ComponentProvider } from "@velloo/provider";
import { captureScreenshot, renderScreen } from "@velloo/renderer";
import { err, ok, type Result } from "@velloo/result";
import type { Board, Config, Screen, Theme, Viewport } from "@velloo/schema";
import {
  activeBoards,
  type DesignFolder,
  LiveBundler,
  liveExtensions,
  orderedBoards,
  registryForScreen,
  renderPassForScreen,
  writeJsonAtomic,
} from "@velloo/server";
import { z } from "zod";
import { withAssetServer } from "../asset-server.ts";
import { checkCloudHealth } from "../cloud.ts";
import { type CloudError, httpFailureFrom, unreachable } from "../cloud-errors.ts";
import { type CloudPublishSlot, uploadLinkBundle } from "../cloud-upload.ts";
import { type BundleScreenshots, captureBundleScreenshots } from "../publish-screenshots.ts";
import {
  bundleInvalid,
  cloudUnhealthy,
  noBoardScreens,
  noScreens,
  type PublishError,
  teamAmbiguous,
  teamNotFound,
} from "./errors.ts";

/**
 * The publish core: design folder → multipart bundle → velloo-cloud share
 * link. Both callers build a {@link PublishPipeline} and run this, so
 * `velloo publish` and the canvas's Publish action cannot drift.
 *
 * The split of responsibilities matters. This module owns everything about
 * *what* gets published (board/screen selection, design.json, screenshots,
 * assets, git provenance) and the two-call upload. It owns no output and no
 * process control: progress arrives through {@link PublishEvent}s, failures are
 * thrown, and the shared Chromium is left open — the one-shot CLI closes it,
 * the daemon keeps it warm.
 */

export type PublishStep = "check" | "select" | "styles" | "bundle" | "capture" | "upload";

export type PublishEvent =
  | { kind: "step"; step: PublishStep; message: string }
  /** Screenshot progress, so a long capture pass isn't silent. */
  | { kind: "capture"; done: number; total: number }
  /** Advisory: something the user should know but that didn't stop the publish. */
  | { kind: "note"; message: string }
  /**
   * What this publish carries, for the record — not a problem and not
   * actionable. Separate from `note` because the canvas surfaces notes as
   * notices, and it already shows provenance in its publish dialog.
   */
  | { kind: "info"; message: string }
  | { kind: "warn"; message: string };

export type PublishReporter = (event: PublishEvent) => void;

/**
 * What the caller supplies: the loaded folder, its resolved providers, and the
 * folder-wide Tailwind CSS. The daemon passes its warm JIT's output; the CLI
 * builds one for the run.
 */
export interface PublishPipeline {
  folder: DesignFolder;
  providers: Record<string, ComponentProvider>;
  defaultProvider: ComponentProvider;
  /** Compiled Tailwind for the whole folder — the cloud serves it as-is. */
  snapshotCss(): Promise<string>;
  /**
   * Live-island bundler for the published `bundle.js`. Publish needs the
   * single-file flavor (apps inlined as data-URL imports), which is not how the
   * daemon configures its own — omit it and one gets built for this run.
   */
  liveBundler?: LiveBundler;
}

export interface PublishRequest {
  /** Board ids to publish; empty/absent = every board in the folder. */
  boardIds?: string[] | undefined;
  /** Link title (default: "<folder name> designs"). */
  title?: string | undefined;
  visibility: "public" | "private";
  /**
   * A password anyone can use to view, whatever the visibility. Sent once at
   * publish and never written anywhere local.
   */
  password?: string | undefined;
  passwordExpiresAt?: string | undefined;
  /** The link slot the user deliberately selected before rendering begins. */
  destination:
    | { mode: "new"; slug?: string | undefined }
    | { mode: "update"; slug: string; expectedVersionId: string | null };
  /** Publish into a team rather than the personal workspace. */
  teamId?: string | undefined;
  /** Captured before destination selection so matching and upload agree. */
  provenance?: PublishProvenance | undefined;
  viewport: Viewport;
  screenshots: boolean;
  /** Optional git-diff slice: the full design still publishes, only previews are skipped. */
  screenshotSelection?:
    | {
        screenIds: ReadonlySet<string>;
        boardIds: ReadonlySet<string>;
      }
    | undefined;
}

export interface PublishOutcome {
  shareUrl: string;
  /** What the link now asks of a visitor — for the summary the CLI prints. */
  visibility: "public" | "private";
  passwordProtected: boolean;
  files: number;
  bytes: number;
  screenshots: number;
  boards: number;
  screens: number;
  commitSha: string | null;
  /** True when this created the link rather than updating the folder's. */
  created: boolean;
  tier?: string | undefined;
  history?: { retained: boolean; versions: number; pruned: number } | undefined;
}

export interface CloudTarget {
  baseUrl: string;
  token: string;
}

export interface PublishProvenance {
  repo: string | null;
  branch: string | null;
}

export interface PublishSourceContext extends PublishProvenance {
  boardIds: string[];
  teamId: string | null;
}

const normalizedBoardIds = (boardIds: string[]): string[] => [...new Set(boardIds)].sort();

/** Why updating a slot may be surprising. Empty means a safe exact match. */
export function publishSlotMismatches(
  slot: CloudPublishSlot,
  current: PublishSourceContext,
): string[] {
  const mismatches: string[] = [];
  if (!slot.context.contextKnown) mismatches.push("older publish has no board-selection context");
  if (slot.teamId !== current.teamId) mismatches.push("team differs");
  if (
    JSON.stringify(normalizedBoardIds(slot.context.boardIds)) !==
    JSON.stringify(normalizedBoardIds(current.boardIds))
  ) {
    mismatches.push("board selection differs");
  }
  if (slot.context.repo !== current.repo) {
    mismatches.push("repository differs");
  } else if (current.repo !== null) {
    // A detached HEAD or otherwise unavailable branch is valid, but not enough
    // evidence to recommend replacing a branch-specific live link.
    if (!slot.context.branch || !current.branch) mismatches.push("branch is unavailable");
    else if (slot.context.branch !== current.branch) mismatches.push("branch differs");
  }
  return mismatches;
}

export function recommendedPublishSlot(
  slots: CloudPublishSlot[],
  current: PublishSourceContext,
): CloudPublishSlot | null {
  return exactPublishSlots(slots, current)[0] ?? null;
}

/** Slots safe enough to present as update destinations. */
export function exactPublishSlots(
  slots: CloudPublishSlot[],
  current: PublishSourceContext,
): CloudPublishSlot[] {
  return slots
    .filter((slot) => publishSlotMismatches(slot, current).length === 0)
    .sort((left, right) => publishedAt(right.lastPublishedAt) - publishedAt(left.lastPublishedAt));
}

const publishedAt = (value: string | null): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

/** The size screens render at for the published bundle, unless a caller says otherwise. */
export const PUBLISH_VIEWPORT: Viewport = { w: 1440, h: 900 };

/** The default link title for a folder — its directory name. */
export function defaultPublishTitle(folderRoot: string): string {
  return `${folderRoot.split("/").filter(Boolean).pop()} designs`;
}

/**
 * The folder's stable cloud identity (config.json `folderId`). Pre-folderId
 * folders get one on their first publish — written back through the raw file
 * (not the parsed Config) so unknown fields survive the round-trip.
 */
async function ensureFolderId(
  folder: string,
  existing: string | undefined,
  report: PublishReporter,
): Promise<string> {
  if (existing) return existing;
  const path = join(folder, ".design", "config.json");
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  const folderId = crypto.randomUUID();
  await writeJsonAtomic(path, { ...raw, folderId });
  report({
    kind: "note",
    message:
      "assigned this folder a cloud id (.design/config.json folderId) — commit it so every clone finds the folder's share links.",
  });
  return folderId;
}

/**
 * Say what source the publish records. Provenance is best-effort and used to be
 * silent, so a folder with no remote — or no repository at all — published with
 * an empty Source on the share card and no way to tell why.
 */
export function reportProvenance(git: PublishProvenance, report: PublishReporter): void {
  if (git.repo) {
    report({
      kind: "info",
      message: git.branch
        ? `source: ${git.repo} on ${git.branch}`
        : `source: ${git.repo} (detached HEAD — no branch recorded)`,
    });
    return;
  }
  report({
    kind: "info",
    message: git.branch
      ? `source: branch ${git.branch} — no git remote, publishing without a repository`
      : "source: not a git repository — publishing without repository or branch",
  });
}

/**
 * Probing git must stay silent: `execFileSync` forwards the child's stderr to
 * ours by default, so a non-git folder would spray `fatal: not a git
 * repository` through the publish output instead of the note we report.
 */
const GIT_PROBE: ExecFileSyncOptionsWithStringEncoding = {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
};

function gitCommitSha(folder: string): string | null {
  try {
    const dirty = execFileSync("git", ["-C", folder, "status", "--porcelain"], GIT_PROBE);
    if (dirty.trim().length > 0) return null;
    return execFileSync("git", ["-C", folder, "rev-parse", "HEAD"], GIT_PROBE).trim();
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
export function normalizeRemote(url: string): string | null {
  const rest = url.trim().replace(/\.git\/?$/, "");
  // A filesystem path is a legal remote but names no host. Reject it up front:
  // `new URL("https:///Users/me/repo")` drops the extra slash for special
  // schemes and reads "Users" as the hostname, inventing `users/me/repo`.
  if (/^[./~]/.test(rest) || /^[a-z]:[\\/]/i.test(rest) || rest.startsWith("file://")) return null;
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
export function gitContext(folder: string): PublishProvenance {
  const run = (args: string[]): string | null => {
    try {
      return execFileSync("git", ["-C", folder, ...args], GIT_PROBE).trim() || null;
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

/** A team by name or UUID. */
export async function resolveTeam(
  baseUrl: string,
  token: string,
  requested?: string,
): Promise<Result<string | undefined, PublishError>> {
  if (!requested) return ok(undefined);
  const listed = await listTeams(baseUrl, token);
  if (!listed.ok) return listed;
  const exact = listed.value.filter(
    (team) => team.id === requested || team.name.toLowerCase() === requested.toLowerCase(),
  );
  if (exact.length === 0) return err(teamNotFound(requested));
  if (exact.length > 1) return err(teamAmbiguous(requested));
  return ok(exact[0]?.id);
}

export interface CloudTeam {
  id: string;
  name: string;
  /** The team a publish lands in when none is named. Absent on older clouds. */
  isDefault?: boolean;
}

/** The caller's teams, for a publish-target picker. */
export async function listTeams(
  baseUrl: string,
  token: string,
): Promise<Result<CloudTeam[], CloudError>> {
  const res = await fetch(`${baseUrl}/v1/teams/mine`, {
    headers: { authorization: `Bearer ${token}` },
  }).catch((error: unknown) => error);
  if (!(res instanceof Response)) return err(unreachable(res, { url: baseUrl }));
  if (!res.ok) return err(await httpFailureFrom("listing teams", res));
  const body = (await res.json()) as { teams: CloudTeam[] };
  return ok(body.teams);
}

/**
 * The boards a publish would ship, in the canvas sidebar's display order.
 *
 * A default publish ships the live boards only. Named ids win over that —
 * asking for an archived board by id is an explicit request, not an oversight.
 */
export function selectBoards(design: DesignFolder, boardIds?: string[]): Board[] {
  if (!boardIds || boardIds.length === 0) {
    return activeBoards(design).map(([, board]) => board);
  }
  const wanted = new Set(boardIds);
  return orderedBoards(design)
    .map(([, board]) => board)
    .filter((board) => wanted.has(board.id));
}

/**
 * Publish `pipeline.folder` to velloo-cloud and return the share link.
 *
 * Every way this can fail is in `PublishError` — the cloud's own refusals plus
 * publishing's (an unwell cloud, a folder with nothing in it, an unresolvable
 * team). Callers render them through `describePublishError`.
 */
export async function publishDesign(
  cloud: CloudTarget,
  pipeline: PublishPipeline,
  request: PublishRequest,
  report: PublishReporter = () => {},
): Promise<Result<PublishOutcome, PublishError>> {
  const { folder: design } = pipeline;
  const root = design.root;
  const config: Config = design.config;

  // Gate on cloud health before any expensive screenshot or bundle work
  // a dead cloud must not cost a full capture pass first.
  report({ kind: "step", step: "check", message: "checking the cloud" });
  const health = await checkCloudHealth(cloud.baseUrl);
  if (health.status === "unreachable")
    return err(unreachable(health.reason, { url: cloud.baseUrl }));
  if (health.status === "unhealthy") return err(cloudUnhealthy(health.detail));

  if (design.screens.size === 0) return err(noScreens(root));

  // Publish whole boards: the selected ones plus every screen they place. A
  // board-less folder publishes all its screens.
  report({ kind: "step", step: "select", message: "collecting boards" });
  const boards = selectBoards(design, request.boardIds);
  const explicit = Boolean(request.boardIds && request.boardIds.length > 0);
  const screenIds = explicit ? new Set(boards.flatMap((b) => b.frames.map((f) => f.screen))) : null; // null ⇒ all screens
  const screens = screenIds
    ? [...design.screens.values()].filter((s) => screenIds.has(s.id))
    : [...design.screens.values()];
  if (screens.length === 0) return err(noBoardScreens());

  const viewport = request.viewport ?? PUBLISH_VIEWPORT;
  const title = request.title?.trim() || defaultPublishTitle(root);
  const form = new FormData();
  let bundleFiles = 0;
  let bundleBytes = 0;

  /**
   * Every bundle file goes through here because a **zero-byte part loses its
   * filename in transit**: the multipart body is well formed, but the receiving
   * parser reports `File.name` as undefined, so the cloud can't tell what the
   * file was. Callers make sure nothing empty gets this far (see snapshot.css
   * below); an empty asset on disk is dropped with a warning, since a zero-byte
   * image can't render anyway.
   */
  const addFile = (path: string, data: string | Uint8Array, type?: string): boolean => {
    const empty = typeof data === "string" ? data.length === 0 : data.byteLength === 0;
    if (empty) {
      report({ kind: "warn", message: `skipped empty file: ${path}` });
      return false;
    }
    form.append("file", new File([data], path, type ? { type } : undefined));
    bundleFiles += 1;
    bundleBytes +=
      typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
    return true;
  };

  // Live-island bundle: when the folder declares render:"live" extensions
  // (charts &c.), compile the host app's real components into one ESM module.
  // The cloud's screen viewer imports it and client-mounts the real component
  // into its marker. No live extensions ⇒ no bundler, no bundle.js.
  const liveExt = liveExtensions(config.extensions);
  const bundler =
    Object.keys(liveExt).length > 0
      ? (pipeline.liveBundler ?? createPublishBundler(root, config))
      : null;

  report({ kind: "step", step: "styles", message: "compiling styles" });
  const snapshotCss = await pipeline.snapshotCss();

  let live = false;
  let liveCode: string | null = null;
  if (bundler) {
    report({ kind: "step", step: "bundle", message: "bundling live components" });
    const bundle = await bundler.build();
    for (const e of bundle.errors) report({ kind: "warn", message: `live-island: ${e.message}` });
    // A bundle that came back empty (every live extension failed to compile) is
    // not a live design — say so in the doc rather than pointing at a file the
    // upload doesn't carry.
    if (addFile("bundle.js", bundle.code, "text/javascript")) {
      liveCode = bundle.code;
      live = true;
    }
  }

  // PNG previews (one per screen, one composite per board, plus a cover) —
  // captured through the same renderScreen → captureScreenshot pipeline the
  // MCP `screenshot` tool uses. Never fatal: no browser (or screenshots off)
  // publishes without them.
  let shots: BundleScreenshots | null = null;
  if (request.screenshots) {
    report({ kind: "step", step: "capture", message: "capturing previews" });
    shots = await withAssetServer(root, liveCode, (baseHref) => {
      const htmlCache = new Map<string, Promise<string>>();
      const renderHtml = async (
        screen: Screen,
        themeName?: string,
        scheme: "light" | "dark" = "light",
      ): Promise<string> => {
        const theme: Theme = (themeName ? design.themes.get(themeName) : undefined) ?? design.theme;
        // NUL separates the two halves: no id or theme name can contain it, so
        // the composite key can't collide the way a printable separator can.
        const key = `${screen.id}\u0000${theme.name}\u0000${scheme}`;
        const cached = htmlCache.get(key);
        if (cached) return cached;
        const rendering = renderScreen(screen, theme, {
          viewport,
          snapshotCss,
          registry: registryForScreen(
            screen,
            pipeline.providers,
            pipeline.defaultProvider,
            config.extensions ?? {},
          ),
          renderPass: renderPassForScreen(
            screen,
            pipeline.providers,
            pipeline.defaultProvider,
            theme,
          ),
          snippets: design.snippets,
          customCss: design.customCss,
          dark: scheme === "dark",
          baseHref,
          ...(live ? { liveBundleUrl: "/live/bundle.js" } : {}),
        }).then(({ html }) => html);
        htmlCache.set(key, rendering);
        return rendering;
      };
      return captureBundleScreenshots({
        screens,
        boards,
        ...(request.screenshotSelection
          ? {
              screenIds: request.screenshotSelection.screenIds,
              boardIds: request.screenshotSelection.boardIds,
            }
          : {}),
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
        warn: (message) => report({ kind: "warn", message }),
        progress: (done, total) => report({ kind: "capture", done, total }),
      });
    });
    for (const f of shots?.files ?? []) addFile(f.path, f.bytes, "image/png");
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
  const designDoc: DesignBundle = {
    formatVersion: DESIGN_BUNDLE_FORMAT,
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
  // Validated, not normalized: the parse would strip any key the schema does
  // not know, and silently shipping a lesser bundle is the failure mode this
  // check exists to prevent. So the literal is what travels.
  const validated = DesignBundleSchema.safeParse(designDoc);
  if (!validated.success) return err(bundleInvalid(z.prettifyError(validated.error)));
  addFile("design.json", JSON.stringify(designDoc), "application/json");
  // A folder with no CSS framework (styling.framework "none") compiles to no
  // stylesheet at all. The doc still names snapshot.css, so send a real —
  // non-empty — file rather than dropping the part the viewer will ask for.
  addFile("snapshot.css", snapshotCss || "/* this folder uses no CSS framework */\n", "text/css");

  // Upload the image assets the bundle actually references (absolute
  // `/assets/…` paths). Only referenced files travel — keeps the publish lean
  // and within the size limit; the cloud serves them under /s/<slug>/assets/.
  // That also means a superseded generation, which no node points at any more,
  // simply doesn't travel.
  //
  // Snippets are scanned alongside screens because they ship in the bundle and
  // render into every screen that instantiates them: an image used only inside
  // a snippet body would otherwise be a broken image on the published page,
  // and silently so — the reference never reaches the "asset not found" warning.
  const assetRefs = new Set<string>();
  const assetRe = /\/assets\/[A-Za-z0-9._@\-/]+/g;
  for (const source of [...screens, ...design.snippets.values()]) {
    for (const m of JSON.stringify(source).matchAll(assetRe)) assetRefs.add(m[0]);
  }
  for (const ref of assetRefs) {
    const rel = ref.replace(/^\//, ""); // assets/foo.png
    try {
      addFile(rel, await readFile(join(root, rel)));
    } catch {
      report({ kind: "warn", message: `asset not found: ${rel}` });
    }
  }

  const commitSha = gitCommitSha(root);
  if (commitSha) form.append("commitSha", commitSha);
  // Repo + branch provenance for the share card. Unlike commitSha these
  // travel even from a dirty tree — they name where the design lives, not
  // an exact state.
  const git = request.provenance ?? gitContext(root);
  reportProvenance(git, report);
  if (git.repo) form.append("gitRepo", git.repo);
  if (git.branch) form.append("gitBranch", git.branch);

  // The folder's cloud identity — the cloud reuses the folder's existing
  // link (200) or creates one carrying it (201).
  const folderId = await ensureFolderId(root, config.folderId, report);

  report({
    kind: "step",
    step: "upload",
    message: `uploading ${bundleFiles} file${bundleFiles === 1 ? "" : "s"} (${formatBytes(bundleBytes)})`,
  });
  const uploaded = await uploadLinkBundle({
    baseUrl: cloud.baseUrl,
    token: cloud.token,
    link: {
      ...(request.destination.slug ? { slug: request.destination.slug } : {}),
      folderId,
      publishMode: request.destination.mode,
      ...(request.destination.mode === "update"
        ? { expectedVersionId: request.destination.expectedVersionId }
        : {}),
      title,
      visibility: request.visibility,
      ...(request.teamId ? { teamId: request.teamId } : {}),
      ...(request.password ? { password: request.password } : {}),
      ...(request.passwordExpiresAt ? { passwordExpiresAt: request.passwordExpiresAt } : {}),
    },
    form,
  });
  if (!uploaded.ok) return uploaded;
  const upload = uploaded.value;

  return ok({
    shareUrl: upload.shareUrl,
    visibility: upload.link.visibility,
    passwordProtected: upload.link.passwordProtected,
    files: upload.files,
    bytes: upload.bytes,
    screenshots: shots?.files.length ?? 0,
    boards: boards.length,
    screens: screens.length,
    commitSha,
    created: upload.created,
    ...(upload.tier !== undefined ? { tier: upload.tier } : {}),
    ...(upload.history !== undefined ? { history: upload.history } : {}),
  });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/**
 * A live bundler configured the way publish needs it: one `bundle.js`, with
 * each host app inlined as a data-URL import instead of a sibling route.
 * Exported so a caller wiring Tailwind can share the instance (its
 * `hostSourceDirs()` feeds the JIT) instead of bundling twice.
 */
export function createPublishBundler(root: string, config: Config): LiveBundler {
  return new LiveBundler(
    root,
    () => config,
    () => liveExtensions(config.extensions),
    true,
    true,
  );
}
