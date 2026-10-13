import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createProvider as createHtmlProvider } from "@velloo/provider-html";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { CanvasBundler } from "../live/canvas-bundler.ts";
import { LiveBundler, liveExtensions } from "../live/component-bundler.ts";
import { LocalCommentsService } from "../local-comments.ts";
import { createMcpServer, type McpServerHandle } from "../mcp/server.ts";
import { fixtureApp } from "../repo/__tests__/fixture-app.ts";
import { createRepoComponents } from "../repo/store.ts";
import { TailwindJit } from "../styles/tailwind-jit.ts";
import {
  designBoard,
  designConfig,
  type TestContext,
  type TestContextOptions,
  testContext,
} from "../testing/design-folder.ts";

/**
 * What a session's brief says about the app the design is for. `buildInstructions`
 * is tested for the paragraphs it can write; which of them a real folder gets
 * is decided when a session opens, from what is on disk — an app or none, with
 * components of its own or only pages — and a paragraph sent to the wrong
 * folder costs every session on it two or three calls on nothing.
 */

const SETUP = "Set this design up for its app first";
const BARE = "**Bare folder.**";
const APP_COMPONENTS = "Build with the app's own components first";

let t: TestContext | undefined;
let handle: McpServerHandle | undefined;
const temps: string[] = [];

afterEach(async () => {
  await handle?.close();
  await t?.cleanup();
  handle = undefined;
  t = undefined;
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** The whole brief a session on this folder is given: the handshake's part and the first result's. */
async function briefFor(options: TestContextOptions, repo = true): Promise<string> {
  const folder = await testContext({ label: "mcp-brief", ...options });
  t = folder;
  const { ctx, root } = folder;
  if (repo) {
    ctx.repo = createRepoComponents(folder.folder, ctx.providers);
    // A session waits only so long for the catalog and reads "not known yet"
    // as "it may have components"; read it first so a slow machine can't turn
    // that into the answer under test.
    await ctx.repo.catalog();
  }
  handle = await createMcpServer(ctx, {
    port: 0,
    host: "127.0.0.1",
    jit: new TailwindJit(
      ctx.defaultProvider,
      join(root, "screens"),
      undefined,
      undefined,
      undefined,
      undefined,
      ctx.folder.config.styling?.framework,
    ),
    bundler: new LiveBundler(
      root,
      () => ctx.folder.config,
      () => liveExtensions(ctx.folder.config.extensions),
    ),
    canvasBundler: new CanvasBundler(
      root,
      () => ctx.folder.config.hostApp,
      () => undefined,
    ),
    comments: new LocalCommentsService(() => ctx, join(root, "comments.json")),
  });
  const client = new Client({ name: "brief-test", version: "0.0.0" });
  // The SDK's own transport type disagrees with `Transport` under
  // exactOptionalPropertyTypes (see mcp-wiring.test.ts).
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${handle.url}?surface=full`)) as Parameters<
      typeof client.connect
    >[0],
  );
  try {
    const first = await client.callTool({ name: "list_boards", arguments: {} });
    const rest = (first.content as { text?: string }[])
      .map((part) => part.text ?? "")
      .filter((text) => text.startsWith("The rest of this session's brief"))
      .join("");
    return (client.getInstructions() ?? "") + rest;
  } finally {
    await client.close();
  }
}

async function appWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "velloo-brief-app-"));
  temps.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), contents, "utf8");
  }
  return root;
}

const noLibrary = (hostRoot: string): TestContextOptions => ({
  provider: createNoneProvider(),
  config: designConfig({
    library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
    styling: { framework: "none" },
    hostApp: { root: hostRoot },
  }),
});

const PAGES_ONLY = {
  "package.json": JSON.stringify({ dependencies: { react: "*", "react-dom": "*" } }),
  "index.html": '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
  "src/main.jsx":
    'import { createRoot } from "react-dom/client";\nimport { App } from "./App";\ncreateRoot(document.getElementById("root")).render(<App />);\n',
  "src/App.jsx": "export function App() {\n  return <main>Reports</main>;\n}\n",
};

describe("the brief for the app a design is bound to", () => {
  test("an app with components of its own: set up first, then build with them", async () => {
    const app = await fixtureApp();
    temps.push(dirname(app.root));
    const brief = await briefFor(noLibrary(app.root));
    expect(brief).toContain(SETUP);
    expect(brief).not.toContain(BARE);
    expect(brief).toContain(APP_COMPONENTS);
    // Setup comes before the paragraph about what to compose with.
    expect(brief.indexOf(SETUP)).toBeLessThan(brief.indexOf(APP_COMPONENTS));
  });

  test("an app that renders only its pages is not sent to a preview entry no screen will use", async () => {
    const brief = await briefFor(noLibrary(await appWith(PAGES_ONLY)));
    // There is still an app to match the theme of…
    expect(brief).toContain(SETUP);
    // …but nothing of its own to compose with.
    expect(brief).not.toContain(APP_COMPONENTS);
  });

  test("a design with no app beside it is a bare folder with a theme to choose", async () => {
    const brief = await briefFor(noLibrary(await appWith({ "README.md": "# notes\n" })));
    expect(brief).toContain(BARE);
    expect(brief).not.toContain(SETUP);
    expect(brief).not.toContain(APP_COMPONENTS);
  });

  test("a server-rendered app has no package manifest, and is still an app to set up for", async () => {
    const root = await appWith({ "templates/base.html": "<html><body></body></html>\n" });
    const brief = await briefFor(
      {
        provider: createHtmlProvider(),
        config: designConfig({
          library: { id: "html", version: "t", source: "binary", componentsPath: "binary" },
          styling: { framework: "none" },
          hostApp: { root },
        }),
      },
      false,
    );
    expect(brief).toContain(SETUP);
    expect(brief).not.toContain(BARE);
  });

  test("once the design has a board, neither first-run paragraph is sent again", async () => {
    const app = await fixtureApp();
    temps.push(dirname(app.root));
    const brief = await briefFor({
      ...noLibrary(app.root),
      screens: { home: true },
      boards: { main: designBoard("main", ["home"]) },
    });
    expect(brief).not.toContain(SETUP);
    expect(brief).not.toContain(BARE);
    // What to compose with is true for the life of the design.
    expect(brief).toContain(APP_COMPONENTS);
  });
});

describe("the brief for a design with a stated design language", () => {
  const FOLLOWS = "**This folder follows a design system document:";

  test("names the design's own guidance.md once rules are saved to it, and says it outranks the defaults", async () => {
    const brief = await briefFor(
      {
        nested: true,
        files: { "guidance.md": "## Do's and Don'ts\n\n- Don't: Shadows on flat surfaces\n" },
      },
      false,
    );
    expect(brief).toContain(`${FOLLOWS} \`guidance.md\`.**`);
    expect(brief).toContain("outrank the generic defaults");
  });

  test("a design that follows nothing is told about no document", async () => {
    expect(await briefFor({ nested: true }, false)).not.toContain(FOLLOWS);
  });
});
