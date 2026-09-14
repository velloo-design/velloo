import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { type CaptureManifest, newCaptureId, writeCaptureManifest } from "./capture-store.ts";

/**
 * The injected toolbar's custom element. It lives in the page's DOM, so every
 * capture path has to exclude it — otherwise velloo's own chrome would show up
 * in the screenshot, the DOM extract, and the offline snapshot.
 */
export const TOOLBAR_TAG = "velloo-capture-toolbar";

/** One element in the structured extract. */
export interface DomNode {
  /** Index into the flat node list; `parent` refers to one of these. */
  i: number;
  parent: number | null;
  depth: number;
  tag: string;
  id?: string;
  class?: string;
  role?: string;
  /** The element's own text, excluding descendants' — truncated. */
  text?: string;
  rect: { x: number; y: number; w: number; h: number };
  style: Record<string, string>;
  src?: string;
  href?: string;
  /**
   * `data-node-path` of the design node that rendered this element, when the
   * page is a Velloo render rather than a captured app page. It is what lets a
   * computed style be attributed to a node the agent can edit.
   */
  nodePath?: string;
  /**
   * Set on the first element of a run of visually identical siblings — the
   * signal that a card grid / list / repeated row is a single component
   * instantiated N times, which is what the agent should re-express it as.
   */
  repeat?: { count: number; signature: string };
}

export interface DomExtract {
  url: string;
  title: string;
  viewport: { w: number; h: number };
  documentHeight: number;
  nodes: DomNode[];
  truncated: boolean;
}

export interface ThemeVars {
  /**
   * CSS text shaped for the existing `import_theme` path — a `:root` block
   * plus a `.dark` block when the page defines one. This is the field to feed
   * straight into that tool; the maps below are for inspection.
   */
  css: string;
  light: Record<string, string>;
  dark: Record<string, string>;
  fonts: string[];
}

const MAX_NODES = 1500;
const MAX_DEPTH = 24;
const MAX_TEXT = 240;
const TRANSIENT_SCREENSHOT_ERROR =
  /Protocol error \(Page\.captureScreenshot\):\s*Unable to capture screenshot/i;

/**
 * Chromium can occasionally reject the underlying CDP capture while the page
 * itself is still healthy. A second attempt can succeed once that transient
 * paint state has cleared. Retry only that exact protocol failure and only
 * once, so closed pages, timeouts, and persistent capture errors keep surfacing.
 *
 * Exported for the focused retry contract test; capturePage is the production
 * caller.
 */
export async function capturePagePng(page: Page, fullPage: boolean): Promise<Buffer> {
  const screenshot = () =>
    page.screenshot({
      fullPage,
      animations: "disabled",
      caret: "hide",
    });

  try {
    return await screenshot();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!TRANSIENT_SCREENSHOT_ERROR.test(message)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 100));
    return await screenshot();
  }
}

/**
 * Computed properties worth carrying. Deliberately a short list: the agent is
 * re-expressing the page in real components against a theme, so layout,
 * spacing, and type matter and the long tail of resolved defaults is noise
 * that would swamp the useful signal.
 */
const STYLE_PROPS = [
  "display",
  "position",
  "flexDirection",
  "flexWrap",
  "alignItems",
  "justifyContent",
  "gap",
  "gridTemplateColumns",
  "padding",
  "margin",
  "width",
  "maxWidth",
  "height",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "color",
  "backgroundColor",
  "backgroundImage",
  "borderRadius",
  "borderWidth",
  "borderColor",
  "borderStyle",
  "boxShadow",
  "opacity",
  "zIndex",
] as const satisfies readonly (keyof CSSStyleDeclaration)[];

/**
 * Walk the rendered page into a flat, bounded node list with computed styles.
 *
 * Runs in the page so it sees what the user sees — post-hydration, post-CSS,
 * with real geometry. Invisible and zero-area elements are dropped: they carry
 * no design information and would otherwise dominate the node budget.
 *
 * Exported because a Velloo render is worth walking with exactly this walker:
 * the design side of a fidelity diff needs the same properties, measured the
 * same way, or the two sides are not comparable. On a Velloo render the
 * elements also carry `data-node-path`, so every measurement lands on a node
 * the agent can address.
 */
export async function extractDom(
  page: Page,
  limits: { maxNodes: number; maxDepth: number; maxText: number } = {
    maxNodes: MAX_NODES,
    maxDepth: MAX_DEPTH,
    maxText: MAX_TEXT,
  },
  toolbarTag: string = TOOLBAR_TAG,
): Promise<DomExtract> {
  return page.evaluate(
    ({ props, maxNodes, maxDepth, maxText, toolbar }) => {
      const nodes: DomNode[] = [];
      let truncated = false;

      const ownText = (el: Element): string => {
        let s = "";
        for (const child of Array.from(el.childNodes)) {
          if (child.nodeType === 3) s += child.textContent ?? "";
        }
        return s.replace(/\s+/g, " ").trim().slice(0, maxText);
      };

      /** Shape-only signature: what makes two siblings "the same card". */
      const signatureOf = (el: Element): string => {
        const cls = (el.getAttribute("class") ?? "").trim();
        return `${el.tagName.toLowerCase()}|${cls}|${el.children.length}`;
      };

      const walk = (el: Element, parent: number | null, depth: number): void => {
        if (nodes.length >= maxNodes) {
          truncated = true;
          return;
        }
        if (depth > maxDepth) {
          truncated = true;
          return;
        }
        if (el.tagName.toLowerCase() === toolbar) return;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return;
        const r = el.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;
        // Zero-area elements are structurally real but visually absent; keeping
        // them would spend the node budget on wrappers nobody can see.
        if (r.width === 0 && r.height === 0) return;

        const style: Record<string, string> = {};
        for (const p of props) {
          const v: unknown = cs[p];
          if (typeof v === "string" && v !== "" && v !== "none" && v !== "normal") style[p] = v;
        }

        const i = nodes.length;
        const entry: DomNode = {
          i,
          parent,
          depth,
          tag: el.tagName.toLowerCase(),
          rect: {
            x: Math.round(r.x + scrollX),
            y: Math.round(r.y + scrollY),
            w: Math.round(r.width),
            h: Math.round(r.height),
          },
          style,
        };
        const id = el.getAttribute("id");
        if (id) entry.id = id;
        const cls = el.getAttribute("class");
        if (cls) entry.class = cls.trim().slice(0, 400);
        const role = el.getAttribute("role") ?? el.getAttribute("aria-label");
        if (role) entry.role = role;
        const t = ownText(el);
        if (t) entry.text = t;
        const src = el.getAttribute("src");
        if (src) entry.src = src;
        const href = el.getAttribute("href");
        if (href) entry.href = href.slice(0, 300);
        const nodePath = el.getAttribute("data-node-path");
        if (nodePath !== null) entry.nodePath = nodePath;
        nodes.push(entry);

        // Detect repeated sibling runs once per parent, on the first member.
        const children = Array.from(el.children);
        const counts = new Map<string, number>();
        for (const c of children) {
          const sig = signatureOf(c);
          counts.set(sig, (counts.get(sig) ?? 0) + 1);
        }
        const seen = new Set<string>();
        for (const c of children) {
          const before = nodes.length;
          walk(c, i, depth + 1);
          const sig = signatureOf(c);
          const n = counts.get(sig) ?? 0;
          if (n >= 3 && !seen.has(sig) && nodes.length > before) {
            seen.add(sig);
            const added = nodes[before];
            if (added) added.repeat = { count: n, signature: sig };
          }
        }
      };

      if (document.body) walk(document.body, null, 0);
      return {
        url: location.href,
        title: document.title,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        documentHeight: Math.max(
          document.documentElement?.scrollHeight ?? 0,
          document.body?.scrollHeight ?? 0,
        ),
        nodes,
        truncated,
      };
    },
    {
      props: STYLE_PROPS,
      maxNodes: limits.maxNodes,
      maxDepth: limits.maxDepth,
      maxText: limits.maxText,
      toolbar: toolbarTag,
    },
  );
}

/**
 * Harvest the page's CSS custom properties into `import_theme`-shaped CSS.
 *
 * Stylesheet rules are the primary source because they carry BOTH palettes —
 * the `:root` block and whatever dark variant the app defines (`.dark`,
 * `[data-theme=dark]`, a `prefers-color-scheme` block) — which a single
 * `getComputedStyle` read cannot see. Computed values fill in anything the
 * rules resolve indirectly. Cross-origin sheets throw on `cssRules` access and
 * are skipped.
 */
async function extractThemeVars(page: Page): Promise<ThemeVars> {
  return page.evaluate(() => {
    const light: Record<string, string> = {};
    const dark: Record<string, string> = {};
    const fonts = new Set<string>();

    const isDarkSelector = (sel: string): boolean =>
      /(^|[\s,>])(\.dark|\[data-theme["'=\s]*dark|\.theme-dark)/i.test(sel);

    const readRule = (rule: CSSRule, intoDark: boolean): void => {
      const style = (rule as CSSStyleRule).style as CSSStyleDeclaration | undefined;
      const selector = (rule as CSSStyleRule).selectorText;
      if (!style || typeof selector !== "string") return;
      // Only root-level declarations define the theme; component rules that
      // happen to set a custom property are local, not tokens.
      if (!/(^|,)\s*(:root|html|body|\.dark|\[data-theme)/i.test(selector)) return;
      const target = intoDark || isDarkSelector(selector) ? dark : light;
      for (let i = 0; i < style.length; i++) {
        const prop = style.item(i);
        if (!prop.startsWith("--")) continue;
        const value = style.getPropertyValue(prop).trim();
        if (value) target[prop] = value;
      }
      const ff = style.getPropertyValue("font-family").trim();
      if (ff) fonts.add(ff);
    };

    const walkRules = (rules: CSSRuleList, intoDark: boolean): void => {
      for (const rule of Array.from(rules)) {
        // A style rule and a grouping rule are not either/or: since nested CSS
        // shipped, a plain CSSStyleRule carries a (usually empty) `cssRules`
        // too. Treating `cssRules` as the discriminator would skip every
        // declaration in the sheet, so read this rule's own declarations first
        // and then descend into whatever it nests.
        const asStyle = rule as CSSStyleRule;
        if (typeof asStyle.selectorText === "string" && asStyle.style) {
          readRule(rule, intoDark);
        }
        const nested = (rule as CSSGroupingRule).cssRules;
        if (nested && nested.length > 0) {
          const cond = rule instanceof CSSConditionRule ? rule.conditionText : "";
          walkRules(nested, intoDark || /prefers-color-scheme\s*:\s*dark/i.test(cond));
        }
      }
    };

    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = (sheet as CSSStyleSheet).cssRules;
        if (rules) walkRules(rules, false);
      } catch {
        // Cross-origin stylesheet — unreadable by design.
      }
    }

    // Fill gaps from the resolved root: an app may set tokens inline or via a
    // sheet we couldn't read, and the resolved value is still the right one.
    const rootStyle = getComputedStyle(document.documentElement);
    for (const prop of Array.from(rootStyle)) {
      if (!prop.startsWith("--")) continue;
      if (light[prop] !== undefined) continue;
      const value = rootStyle.getPropertyValue(prop).trim();
      if (value) light[prop] = value;
    }
    const bodyFont = getComputedStyle(document.body ?? document.documentElement).fontFamily;
    if (bodyFont) fonts.add(bodyFont);

    const block = (sel: string, vars: Record<string, string>): string => {
      const entries = Object.entries(vars);
      if (entries.length === 0) return "";
      return `${sel} {\n${entries.map(([k, v]) => `  ${k}: ${v};`).join("\n")}\n}\n`;
    };
    const css = `${block(":root", light)}${block(".dark", dark)}`;

    return { css, light, dark, fonts: Array.from(fonts) };
  });
}

/** Image URLs referenced by the rendered page, absolute and de-duplicated. */
async function collectAssetUrls(page: Page, max: number): Promise<string[]> {
  return page.evaluate((limit) => {
    const urls = new Set<string>();
    const add = (raw: string | null | undefined): void => {
      if (!raw) return;
      const v = raw.trim();
      if (!v || v.startsWith("data:") || v.startsWith("blob:")) return;
      try {
        urls.add(new URL(v, location.href).href);
      } catch {
        // Unresolvable reference — nothing to fetch.
      }
    };
    for (const img of Array.from(document.images)) {
      add(img.getAttribute("src"));
      const srcset = img.getAttribute("srcset");
      if (srcset) {
        for (const part of srcset.split(",")) add(part.trim().split(/\s+/)[0]);
      }
    }
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none") {
        for (const m of bg.matchAll(/url\((['"]?)(.*?)\1\)/g)) add(m[2]);
      }
      if (urls.size >= limit) break;
    }
    return Array.from(urls).slice(0, limit);
  }, max);
}

const MAX_ASSETS = 40;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

/**
 * Response content type → the extension to save under.
 *
 * A CDN that serves images from a query string (`/th?id=…`) gives a pathname
 * whose last segment carries no extension at all, and the design folder's
 * asset store admits files by extension only. Velloo used to write those
 * files itself and then refuse to import them — so the type comes off the
 * response, which is the authority anyway when a path and a payload disagree.
 *
 * Deliberately a subset of what the store accepts: adding one here without a
 * home there would just move the rejection later. `asset-extensions.test.ts`
 * in the server package holds the two ends together.
 */
export const CAPTURE_ASSET_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
  "image/bmp": ".bmp",
  "font/woff": ".woff",
  "font/woff2": ".woff2",
  "font/ttf": ".ttf",
  "font/otf": ".otf",
};

/**
 * Give a downloaded asset a name the store will accept: keep the URL's own
 * basename when it already ends in the right extension, and otherwise append
 * the one the response's content type implies. Returns null when the type is
 * one the store would refuse regardless — better to drop it at capture time
 * than to write a file that can only fail later.
 */
export function assetFilename(url: string, contentType: string | undefined): string | null {
  const base =
    (new URL(url).pathname.split("/").pop() ?? "asset").replace(/[^A-Za-z0-9._-]/g, "_") || "asset";
  const dot = base.lastIndexOf(".");
  // A path that already ends in an accepted extension wins over the header:
  // appending would give `photo.jpeg.jpg`, and a CDN serving a real PNG as
  // `application/octet-stream` should not cost us the file.
  if (dot > 0 && ACCEPTED_EXTENSIONS.has(base.slice(dot).toLowerCase())) return base;
  const mime = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  const ext = CAPTURE_ASSET_EXTENSIONS[mime];
  // Neither the path nor the payload names a type the store admits, and the
  // store admits by extension — writing this file would only defer the refusal.
  return ext === undefined ? null : `${base}${ext}`;
}

const ACCEPTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ...Object.values(CAPTURE_ASSET_EXTENSIONS),
  ".jpeg",
]);

/**
 * Download referenced images through the page's own context, so anything
 * behind the same session cookies comes back rather than 403-ing. Failures are
 * per-asset and never sink a capture.
 */
async function downloadAssets(
  page: Page,
  urls: readonly string[],
  dir: string,
): Promise<Array<{ url: string; file: string; bytes: number }>> {
  if (urls.length === 0) return [];
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const out: Array<{ url: string; file: string; bytes: number }> = [];
  const used = new Set<string>();
  for (const url of urls) {
    try {
      const res = await page.request.get(url, { timeout: 10_000 });
      if (!res.ok()) continue;
      const body = await res.body();
      if (body.byteLength === 0 || body.byteLength > MAX_ASSET_BYTES) continue;
      const base = assetFilename(url, res.headers()["content-type"]);
      if (base === null) continue;
      let file = base;
      let n = 1;
      while (used.has(file)) file = `${n++}-${base}`;
      used.add(file);
      writeFileSync(join(dir, file), body, { mode: 0o600 });
      out.push({ url, file, bytes: body.byteLength });
    } catch {
      // A single unreachable asset is not a capture failure.
    }
  }
  return out;
}

/**
 * A single-file offline archive of the rendered page, via CDP.
 *
 * Best-effort by design: MHTML replays markup and subresources but does not
 * re-run scripts, and some font/CSS cases don't survive the round trip. The
 * PNG is the fidelity reference; this is the bonus that makes the page
 * browsable offline. Returns null when the protocol call isn't available.
 */
async function captureMhtml(page: Page): Promise<string | null> {
  try {
    const client = await page.context().newCDPSession(page);
    const { data } = (await client.send("Page.captureSnapshot", { format: "mhtml" })) as {
      data: string;
    };
    await client.detach().catch(() => undefined);
    return typeof data === "string" && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}

export interface CapturePageOptions {
  /** Directory root for this folder's captures. */
  capturesRoot: string;
  /** Capture only the theme custom properties — no screenshot, DOM, or assets. */
  themeOnly?: boolean;
  fullPage?: boolean;
}

export interface CaptureOutcome {
  manifest: CaptureManifest;
  dir: string;
  themeVars: ThemeVars;
}

/**
 * Turn the page as it currently stands into a capture directory: the evidence
 * an agent works from. This deliberately does NOT interpret the page — no
 * mapping to components, no tree construction. A scraped DOM is a soup of divs
 * and resolved pixel values while a Velloo tree is semantic (real components,
 * theme tokens); mechanically transforming one into the other produces exactly
 * the absolutely-positioned clone the design workflow tells agents not to
 * build. The agent re-expresses; this gathers.
 */
export async function capturePage(page: Page, opts: CapturePageOptions): Promise<CaptureOutcome> {
  const id = newCaptureId();
  const dir = join(opts.capturesRoot, id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const files: string[] = [];

  // The toolbar is velloo's own chrome injected into the page — it must not
  // appear in any artifact. Hidden for the duration, restored after.
  await page
    .evaluate((tag) => {
      const el = document.querySelector(tag);
      if (el instanceof HTMLElement) el.style.display = "none";
    }, TOOLBAR_TAG)
    .catch(() => undefined);

  try {
    // Read straight from the page: a theme-only capture has no DOM extract to
    // borrow it from, and a manifest without a viewport can't be diffed later.
    const viewport = await page
      .evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
      .catch(() => ({ w: 0, h: 0 }));
    const themeVars = await extractThemeVars(page);
    writeFileSync(join(dir, "computed-vars.json"), `${JSON.stringify(themeVars, null, 2)}\n`, {
      mode: 0o600,
    });
    files.push("computed-vars.json");

    let dom: DomExtract | null = null;
    let assets: Array<{ url: string; file: string; bytes: number }> = [];

    if (!opts.themeOnly) {
      const png = await capturePagePng(page, opts.fullPage ?? true);
      writeFileSync(join(dir, "page.png"), png, { mode: 0o600 });
      files.push("page.png");

      dom = await extractDom(
        page,
        { maxNodes: MAX_NODES, maxDepth: MAX_DEPTH, maxText: MAX_TEXT },
        TOOLBAR_TAG,
      );
      writeFileSync(join(dir, "dom.json"), `${JSON.stringify(dom, null, 2)}\n`, { mode: 0o600 });
      files.push("dom.json");

      const mhtml = await captureMhtml(page);
      if (mhtml) {
        writeFileSync(join(dir, "snapshot.mhtml"), mhtml, { mode: 0o600 });
        files.push("snapshot.mhtml");
      }

      const urls = await collectAssetUrls(page, MAX_ASSETS);
      assets = await downloadAssets(page, urls, join(dir, "assets"));
      if (assets.length > 0) {
        writeFileSync(join(dir, "assets.json"), `${JSON.stringify({ assets }, null, 2)}\n`, {
          mode: 0o600,
        });
        files.push("assets.json");
      }
    }

    const manifest: CaptureManifest = {
      id,
      url: page.url(),
      finalUrl: page.url(),
      title: await page.title().catch(() => ""),
      capturedAt: new Date().toISOString(),
      viewport: dom?.viewport ?? viewport,
      files,
      assetCount: assets.length,
      nodeCount: dom?.nodes.length ?? 0,
      themeOnly: opts.themeOnly === true,
    };
    writeCaptureManifest(dir, manifest);
    return { manifest, dir, themeVars };
  } finally {
    await page
      .evaluate((tag) => {
        const el = document.querySelector(tag);
        if (el instanceof HTMLElement) el.style.display = "";
      }, TOOLBAR_TAG)
      .catch(() => undefined);
  }
}
