import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Viewport } from "@velloo/schema";
import {
  extraThemeBlock,
  findHostTailwindConfig,
  LiveBundler,
  liveExtensions,
  loadDesignFolder,
  migrateConfig,
  resolveProviders,
  TailwindJit,
} from "@velloo/server";
import { defineCommand } from "citty";
import { defaultCloudUrl } from "../cloud.ts";
import { loadCredential } from "../cloud-credentials.ts";
import { fail } from "../fail.ts";
import { pickBoards, resolveDesignFolder } from "../folder.ts";

interface CreatedLink {
  slug: string;
  accessToken: string | null;
}

interface UploadResult {
  files: number;
  bytes: number;
  url: string;
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
    const boards = selected.length
      ? [...design.boards.values()].filter((b) => selectedIds.has(b.id))
      : [...design.boards.values()];
    const screenIds = selected.length
      ? new Set(boards.flatMap((b) => b.frames.map((f) => f.screen)))
      : null; // null ⇒ all screens (board-less folder)
    const screens = screenIds
      ? [...design.screens.values()].filter((s) => screenIds.has(s.id))
      : [...design.screens.values()];
    if (screens.length === 0) fail("publish", "the selected boards have no screens.");

    const config = migrateConfig(design.config);
    const { providers } = await resolveProviders(config, folder);

    // Live-island bundle: when the folder declares render:"live" extensions
    // (charts &c.), compile the host app's real components into one ESM module.
    // The cloud's screen viewer imports it and client-mounts the real component
    // into its marker. No live extensions ⇒ no bundler, no bundle.js.
    const liveExt = liveExtensions(config.extensions);
    const bundler =
      Object.keys(liveExt).length > 0
        ? new LiveBundler(
            folder,
            () => config.hostApp,
            () => liveExt,
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
    if (bundler) {
      const bundle = await bundler.build();
      for (const e of bundle.errors) console.log(`  live-island warning: ${e.message}`);
      form.append("file", new File([bundle.code], "bundle.js", { type: "text/javascript" }));
      live = true;
    }

    // The design model the cloud renders from: raw screen trees + boards + theme
    // + snippets + the slice of config needed to rebuild the component registry.
    // No HTML and no gallery — the cloud owns the frame.
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
      live,
      snapshotCssPath: "snapshot.css",
      ...(live ? { bundlePath: "bundle.js" } : {}),
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

    const authorized = { authorization: `Bearer ${token}` };
    let link: CreatedLink;
    let createdHere = false;
    const createRes = await fetch(`${baseUrl}/v1/links`, {
      method: "POST",
      headers: authorized,
      body: JSON.stringify({
        ...(args.slug ? { slug: args.slug } : {}),
        title,
        visibility,
      }),
    }).catch((error: unknown) => {
      fail(
        "publish",
        `cannot reach ${baseUrl} (${error instanceof Error ? error.message : String(error)}). Is velloo-cloud up? (bun cloud:up)`,
      );
    });
    if (createRes.status === 409 && args.slug) {
      link = { slug: args.slug, accessToken: null };
    } else if (createRes.status === 201) {
      link = (await createRes.json()) as CreatedLink;
      createdHere = true;
    } else {
      const body = (await createRes.json().catch(() => ({}))) as { message?: string };
      fail("publish", `link creation failed (${createRes.status}): ${body.message ?? "unknown"}`);
    }

    const uploadRes = await fetch(`${baseUrl}/v1/links/${link.slug}/versions`, {
      method: "POST",
      headers: authorized,
      body: form,
    });
    if (uploadRes.status !== 201) {
      const body = (await uploadRes.json().catch(() => ({}))) as { message?: string };
      // A link with no version is a dead /s/ page. If we just created it (this
      // run), delete it so a failed publish — e.g. over the size limit — doesn't
      // leave a broken board in the user's home.
      if (createdHere) {
        await fetch(`${baseUrl}/v1/links/${link.slug}`, {
          method: "DELETE",
          headers: authorized,
        }).catch(() => {});
      }
      fail("publish", `upload failed (${uploadRes.status}): ${body.message ?? "unknown"}`);
    }
    const upload = (await uploadRes.json()) as UploadResult;

    // The cloud returns the canonical share URL — absolute (the share domain) in
    // prod, or relative in dev, which we join with the API base.
    const shareLink = upload.url.startsWith("http") ? upload.url : `${baseUrl}${upload.url}`;
    const key = link.accessToken ? `?k=${link.accessToken}` : "";
    console.log(
      `velloo publish: ${upload.files} files, ${Math.round(upload.bytes / 1024)} KB${commitSha ? `, commit ${commitSha.slice(0, 7)}` : ""}`,
    );
    console.log(`  ${shareLink}${key}`);
  },
});
