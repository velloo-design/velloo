import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { renderScreen } from "@velloo/renderer";
import {
  ConfigSchema,
  type Screen,
  ScreenSchema,
  type Snippet,
  SnippetSchema,
  ThemeSchema,
  type Viewport,
} from "@velloo/schema";
import { migrateConfig, resolveProviders, TailwindJit } from "@velloo/server";
import { defineCommand } from "citty";
import { fail } from "../fail.ts";

interface CreatedLink {
  slug: string;
  accessToken: string | null;
}

interface UploadResult {
  files: number;
  bytes: number;
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

function galleryIndex(title: string, screens: Screen[], viewport: Viewport): string {
  const cards = screens
    .map(
      (s) => `
      <a class="card" href="${s.id}.html">
        <span class="name">${s.name}</span>
        <span class="id">${s.id}.html · ${viewport.w}×${viewport.h}</span>
      </a>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { margin: 0; padding: 48px 24px; font: 15px/1.5 system-ui, sans-serif; background: #fafafa; color: #18181b; }
  main { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  p { color: #71717a; margin: 0 0 28px; }
  .card { display: flex; justify-content: space-between; align-items: baseline; gap: 16px;
          padding: 14px 18px; margin-bottom: 10px; background: #fff; border: 1px solid #e4e4e7;
          border-radius: 10px; text-decoration: none; color: inherit; }
  .card:hover { border-color: #a1a1aa; }
  .name { font-weight: 600; }
  .id { color: #71717a; font-size: 13px; }
</style>
</head>
<body>
<main>
  <h1>${title}</h1>
  <p>${screens.length} screen${screens.length === 1 ? "" : "s"}</p>
${cards}
</main>
</body>
</html>
`;
}

export default defineCommand({
  meta: {
    name: "publish",
    description: "Render every screen and publish the folder as a velloo-cloud share link",
  },
  args: {
    folder: {
      type: "positional",
      required: true,
      description: "Path to the design folder (e.g. ./design)",
    },
    url: {
      type: "string",
      description: "velloo-cloud base URL (default: $VELLOO_CLOUD_URL or http://localhost:7400)",
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
    visibility: {
      type: "string",
      description: "public | private (default: public)",
    },
    w: { type: "string", description: "Viewport width in px (default: 1440)" },
    h: { type: "string", description: "Viewport height in px (default: 900)" },
  },
  async run({ args }) {
    const folder = isAbsolute(args.folder) ? args.folder : resolve(args.folder);
    const baseUrl = (args.url ?? process.env.VELLOO_CLOUD_URL ?? "http://localhost:7400").replace(
      /\/+$/,
      "",
    );
    const token = args.token ?? process.env.VELLOO_CLOUD_TOKEN;
    if (!token) {
      fail(
        "publish",
        'no access token. Pass --token or set VELLOO_CLOUD_TOKEN. In dev: curl -s <cloud>/v1/dev/login -d \'{"email":"you@dev.local"}\'',
      );
    }
    const visibility = args.visibility ?? "public";
    if (visibility !== "public" && visibility !== "private") {
      fail("publish", `--visibility must be 'public' or 'private', got '${visibility}'`);
    }
    const viewport: Viewport = {
      w: args.w ? Number(args.w) : 1440,
      h: args.h ? Number(args.h) : 900,
    };

    const screensDir = join(folder, "screens");
    const screenFiles = (await readdir(screensDir).catch(() => null))?.filter((f) =>
      f.endsWith(".json"),
    );
    if (!screenFiles || screenFiles.length === 0) {
      fail("publish", `no screens found in ${screensDir} — is this a velloo design folder?`);
    }

    const [themeJson, configJson] = await Promise.all([
      readFile(join(folder, "theme", "default.json"), "utf8").then(JSON.parse),
      readFile(join(folder, ".design", "config.json"), "utf8").then(JSON.parse),
    ]);
    const theme = ThemeSchema.parse(themeJson);
    const config = migrateConfig(ConfigSchema.parse(configJson));
    const { providers, defaultProvider } = await resolveProviders(config, folder);
    const jit = new TailwindJit(Object.values(providers), screensDir);
    const snapshotCss = await jit.build();

    const screens: Screen[] = [];
    for (const file of screenFiles.sort()) {
      const raw = await readFile(join(screensDir, file), "utf8").then(JSON.parse);
      screens.push(ScreenSchema.parse(raw));
    }

    const snippets = new Map<string, Snippet>();
    const snippetFiles = (await readdir(join(folder, "snippets")).catch(() => [])).filter((f) =>
      f.endsWith(".json"),
    );
    for (const file of snippetFiles) {
      const raw = await readFile(join(folder, "snippets", file), "utf8").then(JSON.parse);
      const snippet = SnippetSchema.parse(raw);
      snippets.set(snippet.id, snippet);
    }

    const title = args.title ?? `${folder.split("/").filter(Boolean).pop()} designs`;
    const form = new FormData();
    let renderedBytes = 0;
    for (const screen of screens) {
      const registry = screen.library
        ? (providers[screen.library] ?? defaultProvider).registry
        : defaultProvider.registry;
      const { html } = await renderScreen(screen, theme, {
        viewport,
        snapshotCss,
        registry,
        snippets,
      });
      form.append("file", new File([html], `${screen.id}.html`, { type: "text/html" }));
      renderedBytes += html.length;
      console.log(`  rendered ${screen.id} (${Math.round(html.length / 1024)} KB)`);
    }
    form.append(
      "file",
      new File([galleryIndex(title, screens, viewport)], "index.html", { type: "text/html" }),
    );
    const commitSha = gitCommitSha(folder);
    if (commitSha) form.append("commitSha", commitSha);

    const authorized = { authorization: `Bearer ${token}` };
    let link: CreatedLink;
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
      fail("publish", `upload failed (${uploadRes.status}): ${body.message ?? "unknown"}`);
    }
    const upload = (await uploadRes.json()) as UploadResult;

    const key = link.accessToken ? `?k=${link.accessToken}` : "";
    console.log(
      `velloo publish: ${upload.files} files, ${Math.round(upload.bytes / 1024)} KB${commitSha ? `, commit ${commitSha.slice(0, 7)}` : ""}`,
    );
    console.log(`  ${baseUrl}/s/${link.slug}/${key}`);
    if (renderedBytes === 0) fail("publish", "rendered zero bytes — something is wrong");
  },
});
