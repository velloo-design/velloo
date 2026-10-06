import { afterEach, describe, expect, test } from "bun:test";
import { utimes } from "node:fs/promises";
import { join } from "node:path";
import type { Screen } from "@velloo/schema";
import { exportScreenHtml } from "../../export/core.ts";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import { appStylesheetFor } from "../app-stylesheet.ts";
import { createRepoComponents } from "../store.ts";

/**
 * An app styled by plain CSS: a global sheet that imports another, names one
 * font beside itself and one the framework serves from `public/`, and a
 * preview entry that imports the sheet — the only thing that tells Velloo the
 * app has one.
 */
const APP = {
  "preview.tsx": `import "../styles/globals.css";

export default function Preview({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
`,
  "../styles/globals.css": `@import "./tokens.css";
@font-face { font-family: Beside; src: url("./beside.woff2"); }
@font-face { font-family: Served; src: url("/fonts/served.woff2"); }
.hero { background: var(--brand); }
.elsewhere { background: url("/not-in-the-app.png"); }
`,
  "../styles/tokens.css": ":root { --brand: rebeccapurple; }\n",
  "../styles/beside.woff2": "beside",
  "../public/fonts/served.woff2": "served",
};

const hero: Screen = {
  id: "home",
  name: "Home",
  tree: {
    $ref: "Box",
    props: { as: "section", className: "hero" },
    children: [{ $ref: "Box", props: { as: "h1", children: "Outcomes" } }],
  },
};

let design: TestContext | undefined;
afterEach(async () => {
  await design?.cleanup();
  design = undefined;
});

async function appDesign(files: Record<string, string> = APP) {
  design = await testContext({ nested: true, screens: { home: hero }, files });
  const repo = createRepoComponents(design.folder, design.ctx.providers);
  return { design, repo };
}

describe("the app's stylesheet", () => {
  test("is the preview entry's sheets, imports inlined and files travelling with them", async () => {
    const { repo } = await appDesign();
    const css = await appStylesheetFor(repo, hero.tree);
    expect(css).toContain("--brand: rebeccapurple");
    expect(css).toContain(".hero");
    expect(css).not.toContain("@import");
    // One font sits beside the sheet, one is served from public/: neither
    // path means anything to a document with no app behind it.
    const base64 = (text: string) => Buffer.from(text).toString("base64");
    expect(css).toContain(`data:font/woff2;base64,${base64("beside")}`);
    expect(css).toContain(`data:font/woff2;base64,${base64("served")}`);
    // A file the app doesn't have stays the URL the sheet wrote.
    expect(css).toContain('url("/not-in-the-app.png")');
  });

  test("is empty when the design has no preview entry", async () => {
    const { repo } = await appDesign({ "../styles/globals.css": APP["../styles/globals.css"] });
    expect(await appStylesheetFor(repo, hero.tree)).toBe("");
    expect(await appStylesheetFor(undefined, hero.tree)).toBe("");
  });

  test("follows an edit to a sheet it imports", async () => {
    const { design: folder, repo } = await appDesign();
    expect(await appStylesheetFor(repo, hero.tree)).toContain("rebeccapurple");
    await folder.write("../styles/tokens.css", ":root { --brand: tomato; }\n");
    // The same mtime tick would look unchanged on a coarse filesystem clock.
    const later = new Date(Date.now() + 5000);
    await utimes(join(folder.root, "../styles/tokens.css"), later, later);
    expect(await appStylesheetFor(repo, hero.tree)).toContain("tomato");
  });
});

describe("standalone HTML export", () => {
  test("carries the app's stylesheet and none of the editor's attributes", async () => {
    const { design: folder, repo } = await appDesign();
    const out = await exportScreenHtml(
      {
        folder: folder.folder,
        providers: folder.ctx.providers,
        defaultProvider: folder.ctx.defaultProvider,
        snapshotCss: async () => "",
        appCss: (screen) => appStylesheetFor(repo, screen.tree),
      },
      hero,
      { viewport: { w: 800, h: 600 } },
    );
    expect(out.html).toContain("<style data-velloo-app-css>");
    expect(out.html).toContain("--brand: rebeccapurple");
    expect(out.html).toContain('class="hero"');
    expect(out.html).not.toContain("data-node-path");
    expect(out.html).not.toContain("<script");
  });
});
