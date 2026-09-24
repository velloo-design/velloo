import { join } from "node:path";
import { isCancel, password, select } from "@clack/prompts";
import { protectedSharesAllowed } from "@velloo/protocol";
import { closePooledBrowser } from "@velloo/renderer";
import type { Viewport } from "@velloo/schema";
import {
  extraThemeBlock,
  findHostTailwindConfig,
  loadDesignFolder,
  resolveProviders,
  screensForBoards,
  TailwindJit,
} from "@velloo/server";
import { defineCommand } from "citty";
import { billingPageUrl, checkCloudHealth, defaultCloudUrl, publishedBoardsUrl } from "../cloud.ts";
import { loadCredential } from "../cloud-credentials.ts";
import { fetchAccount } from "../cloud-login.ts";
import { type CloudPublishSlot, listPublishDestinations } from "../cloud-upload.ts";
import { DESIGN_ARG_DESCRIPTION, pickBoards, resolveDesign } from "../design.ts";
import { fail } from "../fail.ts";
import { confirmRenderFailures } from "../preflight-gate.ts";
import { createProgress, type Progress } from "../progress.ts";
import { changedPreviewsSince } from "../publish/changed-previews.ts";
import {
  createPublishBundler,
  exactPublishSlots,
  gitContext,
  type PublishEvent,
  type PublishOutcome,
  type PublishSourceContext,
  publishDesign,
  recommendedPublishSlot,
  resolveTeam,
} from "../publish/core.ts";
import { describePublishError } from "../publish/errors.ts";
import { listPublished, removePublished } from "../publish/manage.ts";
import { privacyFlagsError, resolvePublishPrivacy } from "../publish/privacy.ts";
import { withSubcommands } from "../subcommands.ts";

const CLOUD_ARGS = {
  url: {
    type: "string",
    description: "velloo-cloud base URL (default: $VELLOO_CLOUD_URL or the built-in default)",
  },
  token: {
    type: "string",
    description: "velloo-cloud access token (default: $VELLOO_CLOUD_TOKEN)",
  },
} as const;

const list = defineCommand({
  meta: { name: "list", description: "List the designs you've published" },
  args: CLOUD_ARGS,
  run: ({ args }) => listPublished(args),
});

const remove = defineCommand({
  meta: { name: "remove", description: "Take a published design down" },
  args: {
    "share-url": {
      type: "positional",
      required: false,
      description: "The share URL to take down (default: pick one interactively)",
    },
    yes: {
      type: "boolean",
      description: "Skip the confirmation (required without an interactive terminal)",
    },
    ...CLOUD_ARGS,
  },
  run: ({ args }) => removePublished({ ...args, shareUrl: args["share-url"] }),
});

const publish = defineCommand({
  meta: {
    name: "publish",
    description: "Publish a design as a velloo-cloud share link",
  },
  args: {
    design: {
      type: "positional",
      required: false,
      description: DESIGN_ARG_DESCRIPTION,
    },
    yes: {
      type: "boolean",
      description:
        "Publish even when a screen's component fails to render (required without an interactive terminal)",
    },
    ...CLOUD_ARGS,
    slug: {
      type: "string",
      description: "Custom slug for --new (default: server-generated)",
    },
    new: {
      type: "boolean",
      description: "Create a separate publish link instead of updating an existing slot",
    },
    update: {
      type: "boolean",
      description: "Update the exact matching published design",
    },
    title: {
      type: "string",
      description: "Link title (default: the design's name)",
    },
    boards: {
      type: "string",
      description:
        "Comma-separated board ids to publish (default: pick interactively; all when non-interactive)",
    },
    visibility: {
      type: "string",
      description: "public | private — explicit alternative to the interactive privacy prompt",
    },
    public: {
      type: "boolean",
      description: "Publish for anyone with the link; skips the privacy prompt",
    },
    private: {
      type: "boolean",
      description: "Publish for your organization only; skips the privacy prompt",
    },
    password: {
      type: "boolean",
      description:
        "Password-protect the link; anyone with the password can view. Prompts for it, or reads $VELLOO_SHARE_PASSWORD",
    },
    "password-expires": {
      type: "string",
      description: "Stop accepting the password after this date (YYYY-MM-DD or ISO timestamp)",
    },
    team: {
      type: "string",
      description: "Publish into a team by name or UUID (default: personal workspace)",
    },
    w: { type: "string", description: "Viewport width in px (default: 1440)" },
    h: { type: "string", description: "Viewport height in px (default: 900)" },
    "changed-since": {
      type: "string",
      description:
        "Capture only screen/board previews affected since this git ref (the full design still publishes)",
    },
  },
  async run({ args }) {
    const folder = await resolveDesign(args.design, "publish");
    const baseUrl = args.url ? args.url.replace(/\/+$/, "") : defaultCloudUrl();
    const token =
      args.token ?? process.env.VELLOO_CLOUD_TOKEN ?? (await loadCredential(baseUrl))?.token;
    if (!token) {
      fail("publish", "not logged in. Run `velloo login` (or pass --token / VELLOO_CLOUD_TOKEN).");
    }
    const interactive = Boolean(process.stdin.isTTY);
    const team = await resolveTeam(baseUrl, token, args.team);
    if (!team.ok) fail("publish", describePublishError(team.error));
    const teamId = team.value;
    const viewport: Viewport = {
      w: args.w ? Number(args.w) : 1440,
      h: args.h ? Number(args.h) : 900,
    };

    // Folder load first: schema-version / parse refusals must surface even when
    // the cloud is down. The core's health gate still runs before any expensive
    // screenshot or bundle work.
    const design = await loadDesignFolder(folder);
    const config = design.config;
    const health = await checkCloudHealth(baseUrl);
    if (health.status === "unreachable") {
      fail(
        "publish",
        `cannot reach ${baseUrl} (${health.reason}). Is velloo-cloud up? (bun cloud:up)`,
      );
    }
    if (health.status === "unhealthy") fail("publish", health.detail);

    // The plan decides which access modes exist, so it is read before any
    // prompt: `--private` on a free plan stops here, not after the board picker.
    const account = await fetchAccount(baseUrl, token, 5000);
    const protectedShares = protectedSharesAllowed(
      account.status === "ok" ? account.account.tier : undefined,
    );
    // Only a free plan is ever sent anywhere, so only it pays for the lookup.
    const upgradeUrl = protectedShares ? undefined : await billingPageUrl(baseUrl);
    const flagsError = privacyFlagsError(args, protectedShares, upgradeUrl);
    if (flagsError) fail("publish", flagsError);

    // Board choice is a CLI concern (an interactive multiselect, or --boards);
    // the core just takes ids. A folder with no boards yields [] — every screen.
    const selected = await pickBoards(folder, args.boards, interactive, "publish");
    if (selected === null) {
      console.log("velloo publish: no boards selected — nothing was published.");
      return;
    }
    const provenance = gitContext(folder);
    const selectedBoardIds = new Set(selected.map((board) => board.id));
    const selectedBoards = [...design.boards.values()].filter((board) =>
      selectedBoardIds.has(board.id),
    );
    const screenshotSelection = args["changed-since"]
      ? (() => {
          try {
            return changedPreviewsSince(
              folder,
              args["changed-since"],
              [...design.screens.values()],
              design.snippets,
              selectedBoards,
            );
          } catch (error) {
            fail(
              "publish",
              `cannot determine previews changed since '${args["changed-since"]}': ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        })()
      : undefined;
    const listed = await (async () => {
      if (!config.folderId || args.new === true) {
        return { effectiveTeamId: teamId ?? null, slots: [] as CloudPublishSlot[] };
      }
      const destinations = await listPublishDestinations({
        baseUrl,
        token,
        folderId: config.folderId,
        ...(teamId ? { teamId } : {}),
      });
      if (!destinations.ok) fail("publish", describePublishError(destinations.error));
      return destinations.value;
    })();
    const source: PublishSourceContext = {
      boardIds: selected.map((board) => board.id),
      teamId: listed.effectiveTeamId,
      ...provenance,
    };
    const destination = await choosePublishDestination({
      slots: listed.slots,
      source,
      interactive,
      createNew: args.new === true,
      updateExisting: args.update === true,
      customSlug: args.slug,
      manageUrl: await publishedBoardsUrl(baseUrl),
    });

    // Destination failures happen before privacy/password questions or any
    // render work, so --update with no exact slot stops immediately.
    const privacy = await resolvePublishPrivacy(args, interactive, {
      protectedShares,
      ...(upgradeUrl ? { upgradeUrl } : {}),
    }).catch((error: unknown) =>
      fail("publish", error instanceof Error ? error.message : String(error)),
    );
    const visibility = privacy.visibility;
    const password = privacy.password ? await readSharePassword() : undefined;
    const passwordExpiresAt = resolvePasswordExpiry(args["password-expires"], password != null);
    const { providers, defaultProvider } = await resolveProviders(config, folder);

    // Last gate before the expensive work, and the last one where the answer
    // can still be "no": a share link is read by someone who cannot tell a
    // placeholder from a design.
    await confirmRenderFailures(
      "publish",
      { folder: design, providers, defaultProvider },
      source.boardIds.length > 0
        ? screensForBoards(design, source.boardIds)
        : [...design.screens.values()],
      args.yes === true,
    );

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

    const progress = createProgress();
    const report = createPublishReporter(progress);
    let outcome: PublishOutcome;
    try {
      const published = await publishDesign(
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
          ...(password ? { password } : {}),
          ...(passwordExpiresAt ? { passwordExpiresAt } : {}),
          destination,
          ...(teamId ? { teamId } : {}),
          provenance,
          viewport,
          ...(screenshotSelection ? { screenshotSelection } : {}),
        },
        report,
      );
      if (!published.ok) {
        progress.fail("publish failed");
        fail("publish", describePublishError(published.error));
      }
      outcome = published.value;
      progress.succeed("published design");
    } catch (error) {
      progress.fail("publish failed");
      fail("publish", error instanceof Error ? error.message : String(error));
    } finally {
      // Release the shared Chromium — publish is a one-shot process, and an
      // open browser connection would keep it alive after the upload.
      await closePooledBrowser();
    }

    console.log(
      `velloo publish: ${outcome.files} files, ${Math.round(outcome.bytes / 1024)} KB${outcome.screenshots > 0 ? `, ${outcome.screenshots} screenshots` : ""}${outcome.commitSha ? `, commit ${outcome.commitSha.slice(0, 7)}` : ""}`,
    );
    console.log(`  ${outcome.shareUrl}`);
    console.log(`  ${describeAccess(outcome)}`);
    // Version-history messaging (folderId-aware clouds only). The share URL is
    // stable now, so a re-publish REPLACES what viewers see: free keeps only
    // the latest version, paid tiers retain every publish for pinning.
    const history = outcome.history;
    if (history && !history.retained && history.pruned > 0) {
      console.log("  replaced the previous version — the free plan keeps only the latest.");
      console.log(
        `  Upgrade your plan to keep version history and revisit past publishes: ${await billingPageUrl(baseUrl)}`,
      );
    } else if (history?.retained && history.versions > 1) {
      console.log(
        `  history: ${history.versions} versions kept — pin any of them from ${outcome.shareUrl}v/<version>/`,
      );
    }
  },
});

export default withSubcommands(publish, { list, remove });

export type DestinationChoice =
  | { mode: "new"; slug?: string }
  | { mode: "update"; slug: string; expectedVersionId: string | null };

/** Turn the prompt's wire value into a guarded destination; null is cancellation. */
export function resolvePublishDestinationChoice(
  value: string | null,
  slots: CloudPublishSlot[],
): DestinationChoice | null {
  if (value === null) return null;
  if (value === "new") return { mode: "new" };
  const slug = value.replace(/^update:/, "");
  const slot = slots.find((candidate) => candidate.slug === slug);
  if (!slot) return null;
  return { mode: "update", slug: slot.slug, expectedVersionId: slot.latestVersionId };
}

export async function choosePublishDestination(opts: {
  slots: CloudPublishSlot[];
  source: PublishSourceContext;
  interactive: boolean;
  createNew: boolean;
  updateExisting: boolean;
  customSlug?: string | undefined;
  manageUrl: string;
  log?: (message: string) => void;
}): Promise<DestinationChoice> {
  if (opts.createNew && opts.updateExisting) {
    fail("publish", "choose either --new or --update, not both");
  }
  if (opts.customSlug && !opts.createNew) {
    fail("publish", "--slug names a new link; use it together with --new");
  }
  const matching = exactPublishSlots(opts.slots, opts.source);
  if (opts.updateExisting) {
    const slot = matching[0];
    if (!slot) {
      fail(
        "publish",
        `there is no exact published-design match to update. Manage existing boards at ${opts.manageUrl}`,
      );
    }
    return {
      mode: "update",
      slug: slot.slug,
      expectedVersionId: slot.latestVersionId,
    };
  }
  if (opts.createNew) {
    return { mode: "new", ...(opts.customSlug ? { slug: opts.customSlug } : {}) };
  }
  if (matching.length === 0) {
    (opts.log ?? console.log)(
      "velloo publish: no matching published design — a new link will be created.",
    );
    return { mode: "new" };
  }
  if (!opts.interactive) {
    fail("publish", "this folder already has published designs; pass --update or --new explicitly");
  }

  const recommended = recommendedPublishSlot(opts.slots, opts.source);
  const latestMatch = matching[0];
  const value = await select({
    message: "Publish destination",
    initialValue: recommended ? `update:${recommended.slug}` : "new",
    options: [
      ...(latestMatch
        ? [
            {
              value: `update:${latestMatch.slug}`,
              label: `Update ${latestMatch.title || "Untitled design"}`,
              hint: "latest exact match for this team, board selection, and source",
            },
          ]
        : []),
      {
        value: "new",
        label: "Create a new link",
        hint: recommended ? "keep the matching design separate" : "recommended for this source",
      },
    ],
  });
  const destination = resolvePublishDestinationChoice(
    isCancel(value) ? null : String(value),
    matching,
  );
  if (!destination) {
    fail("publish", isCancel(value) ? "cancelled" : "selected publish slot is no longer available");
  }
  return destination;
}

/** Turn the core's events into one live line, with compact stage lines in CI. */
export function createPublishReporter(progress: Progress): (event: PublishEvent) => void {
  let latestCapture: string | undefined;
  return (event) => {
    if (event.kind === "capture") {
      latestCapture = `capturing previews ${event.done}/${event.total}`;
      progress.step(latestCapture, { transient: true });
      return;
    }
    if (event.kind === "step") {
      // Preserve the final count in line-based logs without printing every tick.
      if (latestCapture) progress.step(latestCapture);
      latestCapture = undefined;
      progress.step(event.message);
      return;
    }
    progress.log(event.message);
  };
}

/**
 * A share password never arrives as a flag value — a secret typed on a command
 * line lands in shell history and in `ps` output for anyone on the machine.
 * `--password` says "protect this"; the value comes from a masked prompt, or
 * from the environment when there's no terminal to prompt at (CI).
 */
async function readSharePassword(): Promise<string> {
  const fromEnv = process.env.VELLOO_SHARE_PASSWORD?.trim();
  if (fromEnv) {
    if (fromEnv.length < 3) fail("publish", "VELLOO_SHARE_PASSWORD must be at least 3 characters");
    return fromEnv;
  }
  if (!process.stdin.isTTY) {
    fail("publish", "--password needs a terminal to prompt — set $VELLOO_SHARE_PASSWORD instead");
  }
  const entered = await password({
    message: "Password for this share link",
    validate: (value) => ((value ?? "").length < 3 ? "At least 3 characters." : undefined),
  });
  if (isCancel(entered)) fail("publish", "cancelled");
  return entered as string;
}

/** `YYYY-MM-DD` (end of that day) or a full ISO instant. */
function resolvePasswordExpiry(raw: string | undefined, hasPassword: boolean): string | undefined {
  if (!raw) return undefined;
  if (!hasPassword) fail("publish", "--password-expires needs --password");
  const value = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59` : raw;
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) {
    fail(
      "publish",
      `--password-expires must be a date (YYYY-MM-DD) or ISO timestamp, got '${raw}'`,
    );
  }
  return when.toISOString();
}

/** What the link now asks of a visitor, said plainly. */
function describeAccess(outcome: PublishOutcome): string {
  if (outcome.visibility === "private") {
    return outcome.passwordProtected
      ? "private — your organization, or anyone with the password"
      : "private — anyone signed in at your organization";
  }
  return outcome.passwordProtected
    ? "public — anyone with the link and the password"
    : "public — anyone with the link";
}
