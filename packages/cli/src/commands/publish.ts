import { join } from "node:path";
import { closePooledBrowser } from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import {
  extraThemeBlock,
  findHostTailwindConfig,
  loadDesignFolder,
  resolveProviders,
  TailwindJit,
} from "@velloo/server";
import { defineCommand } from "citty";
import { defaultCloudUrl } from "../cloud.ts";
import { loadCredential } from "../cloud-credentials.ts";
import { CloudUnreachableError } from "../cloud-upload.ts";
import { fail } from "../fail.ts";
import { FOLDER_ARG_DESCRIPTION, pickBoards, resolveDesignFolder } from "../folder.ts";
import {
  createPublishBundler,
  type PublishEvent,
  type PublishOutcome,
  publishDesign,
  resolveTeam,
} from "../publish/core.ts";

export default defineCommand({
  meta: {
    name: "publish",
    description: "Publish the design folder as a velloo-cloud share link (the cloud renders it)",
  },
  args: {
    folder: {
      type: "positional",
      required: false,
      description: FOLDER_ARG_DESCRIPTION,
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
    team: {
      type: "string",
      description: "Publish into a team by name or UUID (default: personal workspace)",
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
    const teamId = await resolveTeam(baseUrl, token, args.team);
    const viewport: Viewport = {
      w: args.w ? Number(args.w) : 1440,
      h: args.h ? Number(args.h) : 900,
    };

    // Folder load first: schema-version / parse refusals must surface even when
    // the cloud is down. The core's health gate still runs before any expensive
    // screenshot or bundle work.
    const design = await loadDesignFolder(folder);
    const config = design.config;
    const { providers, defaultProvider } = await resolveProviders(config, folder);

    // Board choice is a CLI concern (an interactive multiselect, or --boards);
    // the core just takes ids. A folder with no boards yields [] — every screen.
    const interactive = Boolean(process.stdin.isTTY);
    const selected = await pickBoards(folder, args.boards, interactive, "publish");

    // The publish-flavored live bundler is shared with the JIT below so the host
    // app's classes compile from the same source dirs we bundle from.
    const bundler = createPublishBundler(folder, config);
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
      () => bundler.hostSourceDirs(),
      () => findHostTailwindConfig(folder, config.hostApp),
      config.styling?.framework,
    );

    let outcome: PublishOutcome;
    try {
      outcome = await publishDesign(
        { baseUrl, token },
        {
          folder: design,
          providers,
          defaultProvider,
          snapshotCss: () => jit.build(),
          liveBundler: bundler,
        },
        {
          boardIds: selected.map((b) => b.id),
          ...(args.title ? { title: args.title } : {}),
          visibility,
          ...(args.slug ? { slug: args.slug } : {}),
          ...(teamId ? { teamId } : {}),
          viewport,
          screenshots: args.screenshots !== false,
        },
        report,
      );
    } catch (error) {
      if (error instanceof CloudUnreachableError) {
        fail(
          "publish",
          `cannot reach ${baseUrl} (${error.message}). Is velloo-cloud up? (bun cloud:up)`,
        );
      }
      fail("publish", error instanceof Error ? error.message : String(error));
    } finally {
      // Release the shared Chromium — publish is a one-shot process, and an
      // open browser connection would keep it alive after the upload.
      await closePooledBrowser();
    }

    const key = outcome.accessToken ? `?k=${outcome.accessToken}` : "";
    console.log(
      `velloo publish: ${outcome.files} files, ${Math.round(outcome.bytes / 1024)} KB${outcome.screenshots > 0 ? `, ${outcome.screenshots} screenshots` : ""}${outcome.commitSha ? `, commit ${outcome.commitSha.slice(0, 7)}` : ""}`,
    );
    console.log(`  ${outcome.shareUrl}${key}`);
    // Version-history messaging (folderId-aware clouds only). The share URL is
    // stable now, so a re-publish REPLACES what viewers see: free keeps only
    // the latest version, paid tiers retain every publish for pinning.
    const history = outcome.history;
    if (history && !history.retained && history.pruned > 0) {
      console.log("  replaced the previous version — the free plan keeps only the latest.");
      console.log(
        "  Upgrade to Team to keep version history and revisit past publishes: https://velloo.ai/pricing",
      );
    } else if (history?.retained && history.versions > 1) {
      console.log(
        `  history: ${history.versions} versions kept — pin any of them from ${outcome.shareUrl}v/<version>/`,
      );
    }
  },
});

/**
 * Console flavor of the core's progress events. Steps stay quiet — publish has
 * always printed only its summary — while notes and warnings keep the indented
 * two-space form earlier versions used.
 */
function report(event: PublishEvent): void {
  if (event.kind === "note" || event.kind === "warn") console.log(`  ${event.message}`);
}
