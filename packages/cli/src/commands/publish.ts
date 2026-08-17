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
import { loadCredential } from "../cloud-credentials.ts";
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

const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

function galleryIndex(title: string, screens: Screen[], viewport: Viewport): string {
  const cards = screens
    .map(
      (s) => `
    <a class="card" href="${s.id}.html" data-screen="${s.id}">
      <span class="preview" style="aspect-ratio:${viewport.w}/${viewport.h}">
        <iframe src="${s.id}.html" loading="lazy" tabindex="-1"
                style="width:${viewport.w}px;height:${viewport.h}px"></iframe>
      </span>
      <span class="meta">
        <span class="name">${escapeHtml(s.name)}</span>
        <span class="actions">
          <span class="id">${viewport.w}×${viewport.h}</span>
          <button class="fullscreen" data-screen="${s.id}" title="Full screen">⛶</button>
        </span>
      </span>
    </a>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 24px; font: 15px/1.5 system-ui, sans-serif; background: #fafafa; color: #18181b; }
  main { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #71717a; margin: 0 0 28px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
  .card { display: block; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px;
          overflow: hidden; text-decoration: none; color: inherit; }
  .card:hover { border-color: #a1a1aa; box-shadow: 0 2px 12px rgba(0,0,0,.06); }
  .preview { display: block; position: relative; overflow: hidden; background: #fff;
             border-bottom: 1px solid #f0f0f2; }
  .preview iframe { border: 0; position: absolute; top: 0; left: 0;
                    transform-origin: top left; pointer-events: none; }
  .meta { display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; }
  .name { font-weight: 600; font-size: 14px; }
  .actions { display: flex; align-items: center; gap: 10px; }
  .id { color: #71717a; font-size: 12px; }
  .fullscreen { border: 1px solid #e4e4e7; background: #fff; border-radius: 6px; padding: 2px 8px;
                font-size: 14px; cursor: pointer; color: #52525b; }
  .fullscreen:hover { border-color: #a1a1aa; color: #18181b; }
  #overlay { position: fixed; inset: 0; background: #fafafa; z-index: 9999; display: flex; flex-direction: column; }
  #overlay[hidden] { display: none; }
  #overlay-bar { display: flex; justify-content: space-between; align-items: center;
                 padding: 10px 16px; border-bottom: 1px solid #e4e4e7; background: #fff; }
  #overlay-title { font-weight: 600; font-size: 14px; }
  #overlay-close { border: 1px solid #e4e4e7; background: #fff; border-radius: 8px; width: 32px; height: 32px;
                   font-size: 16px; cursor: pointer; color: #52525b; line-height: 1; }
  #overlay-close:hover { border-color: #a1a1aa; color: #18181b; }
  #overlay iframe { flex: 1; border: 0; width: 100%; background: #fff; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">${screens.length} screen${screens.length === 1 ? "" : "s"} · click a card to view full screen</p>
  <div class="grid">
${cards}
  </div>
</main>
<div id="overlay" hidden>
  <div id="overlay-bar">
    <span id="overlay-title"></span>
    <button id="overlay-close" aria-label="Close (Esc)">✕</button>
  </div>
  <iframe id="overlay-frame" title="Screen preview"></iframe>
</div>
<script>
(() => {
  const names = ${JSON.stringify(Object.fromEntries(screens.map((s) => [s.id, s.name])))};
  const overlay = document.getElementById("overlay");
  const frame = document.getElementById("overlay-frame");
  const overlayTitle = document.getElementById("overlay-title");

  const open = (id) => {
    if (!(id in names)) return;
    frame.src = id + ".html";
    overlayTitle.textContent = names[id];
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    if (location.hash !== "#" + id) history.pushState(null, "", "#" + id);
  };
  const close = () => {
    if (overlay.hidden) return;
    overlay.hidden = true;
    frame.src = "about:blank";
    document.body.style.overflow = "";
    if (location.hash) history.pushState(null, "", location.pathname + location.search);
  };

  for (const card of document.querySelectorAll("[data-screen]")) {
    card.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      open(card.dataset.screen);
    });
  }
  document.getElementById("overlay-close").addEventListener("click", close);
  window.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  window.addEventListener("popstate", () => {
    const id = location.hash.slice(1);
    if (id in names) open(id); else close();
  });

  // Scale each preview iframe to its card's width.
  const fit = () => {
    for (const p of document.querySelectorAll(".preview")) {
      const iframe = p.querySelector("iframe");
      p.style.height = "";
      iframe.style.transform = "scale(" + p.clientWidth / ${viewport.w} + ")";
    }
  };
  window.addEventListener("resize", fit);
  fit();

  if (location.hash) open(location.hash.slice(1));
})();
</script>
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
