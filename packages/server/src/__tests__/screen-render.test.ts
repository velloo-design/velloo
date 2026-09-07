import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createApp } from "../app.ts";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import { testContext } from "../testing/design-folder.ts";

/**
 * `/api/render/:screenId` end to end, against the real provider and a real
 * Tailwind compile.
 *
 * The canvas draws every frame by fetching this route, so anything that makes
 * the CSS compile throw — a stylesheet `@import`ing a package that isn't
 * installed, most memorably — turns the route into a 500 and every screen on
 * the canvas into a white box. The compile is all-or-nothing, so proving one
 * screen comes back styled covers the whole surface.
 */

const SCREEN = "kitchen-sink";

/** Spans the fidelity ladder: a plain primitive, a cva variant, a control whose
 *  state a design can only express statically, an overlay pinned open in design
 *  mode, and a velloo helper. */
const tree = {
  $ref: "Card",
  props: { className: "flex flex-col gap-4 bg-background p-6" },
  children: [
    { $ref: "Heading", props: { level: 1, children: "Reports" } },
    { $ref: "Badge", props: { variant: "secondary", children: "Beta" } },
    { $ref: "Button", props: { variant: "outline", size: "sm", children: "Export" } },
    { $ref: "Input", props: { value: "acme.com", className: "max-w-xs" } },
    {
      $ref: "Tooltip",
      children: [{ $ref: "TooltipContent", props: { children: "Download a CSV" } }],
    },
  ],
};

let harness: Awaited<ReturnType<typeof testContext>>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  harness = await testContext({
    label: "screen-render",
    screens: { [SCREEN]: { id: SCREEN, name: "Kitchen Sink", tree } },
  });
  const { folder, ctx } = harness;
  app = createApp(
    () => ctx,
    new TailwindJit(ctx.defaultProvider, join(folder.root, "screens")),
    new LiveBundler(
      folder.root,
      () => folder.config,
      () => liveExtensions(folder.config.extensions),
    ),
    new CanvasBundler(
      folder.root,
      () => folder.config.hostApp,
      () => undefined,
    ),
  );
});

afterAll(() => harness?.cleanup());

async function render(): Promise<{ status: number; html: string }> {
  const res = await app.fetch(
    new Request(`http://localhost/api/render/${SCREEN}?w=1180&h=900&mode=light&canvas=1&v=1.0`, {
      headers: { origin: "http://localhost" },
    }),
  );
  return { status: res.status, html: await res.text() };
}

const styleBlock = (html: string): string =>
  html.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? "";

describe("/api/render/:screenId", () => {
  test("serves the screen rather than failing the CSS compile", async () => {
    // A 500 here is the white-box symptom: the canvas gets no document at all.
    expect((await render()).status).toBe(200);
  });

  test("renders the components in the tree, not an empty document", async () => {
    const { html } = await render();
    expect(html).toContain("Reports");
    expect(html).toContain("Export");
    expect(html).toContain('data-slot="badge"');
    expect(html).toContain('data-slot="button"');
    // The design ships `value` with no handler; the snapshot's adaptation makes
    // that a readOnly input rather than a React-warned, inert one. React's
    // static renderer leaves the attribute camelCased, which HTML reads
    // case-insensitively.
    expect(html).toContain('value="acme.com"');
    expect(html).toMatch(/readonly=/i);
  });

  test("pins an overlay open and inline so its styling is visible", async () => {
    const { html } = await render();
    expect(html).toContain("Download a CSV");
    expect(html).toContain('data-state="open"');
  });

  test("ships compiled Tailwind, not an empty stylesheet", async () => {
    const css = styleBlock((await render()).html);
    // A failed compile can also surface as a 200 with nothing in <style>.
    expect(css.length).toBeGreaterThan(10_000);
    for (const utility of ["bg-background", "flex", "gap-4", "p-6"]) {
      expect(css).toContain(utility);
    }
  });

  test("compiles the utilities that only the vendored stylesheets define", async () => {
    const css = styleBlock((await render()).html);
    // `animate-in` comes from tw-animate-css and `data-open` from upstream's
    // shadcn-tailwind.css — the two `@import`s that resolve out of node_modules
    // and off disk. Every overlay's enter/exit styling is written against them,
    // so if either import breaks these silently become no-ops.
    expect(css).toContain("animate-in");
    expect(css).toContain("data-open");
  });

  /**
   * Class attributes are stripped: they are upstream's, they change on every
   * re-vendor, and a snapshot full of them would be rewritten unread. What is
   * worth pinning is the shape — element nesting, `data-slot` identity, and the
   * `data-node-path` values the inspector and iframe click-to-select address
   * nodes by. Those changing silently is a real break.
   */
  test("renders a stable element structure", async () => {
    const { html } = await render();
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? "";
    const skeleton = body
      // The canvas injects its selection runtime into every frame; it is the
      // renderer's business, not this screen's.
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/\s(?:class|style)="[^"]*"/g, "")
      .replace(/></g, ">\n<")
      .trim();
    expect(skeleton).toMatchSnapshot();
  });

  test("carries the theme tokens the utilities resolve against", async () => {
    const { html } = await render();
    const css = styleBlock(html);
    // Without these every `bg-*` / `text-*` resolves to nothing, and the frame
    // paints white however much CSS came back.
    expect(css).toContain("--color-background");
    expect(css).toContain("--color-foreground");
    expect(html).toMatch(/oklch\(/);
  });
});
