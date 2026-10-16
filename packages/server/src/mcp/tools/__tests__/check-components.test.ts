import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createProvider as createNoneProvider } from "@velloo/provider-none";
import { createProvider as createUpstreamProvider } from "@velloo/provider-shadcn-upstream";
import type { CanvasBundler } from "../../../live/canvas-bundler.ts";
import type { LiveBundler } from "../../../live/component-bundler.ts";
import { fixtureApp } from "../../../repo/__tests__/fixture-app.ts";
import { createRepoComponents } from "../../../repo/store.ts";
import type { TailwindJit } from "../../../styles/tailwind-jit.ts";
import {
  designConfig,
  type TestContext,
  type TestContextOptions,
  testContext,
} from "../../../testing/design-folder.ts";
import { registerRepoTools } from "../repo.ts";

/**
 * What `check_components` and `set_preview_entry` answer before a browser is
 * involved: the refusals, and the cases where there is nothing to mount. The
 * tools are registered with no stylesheet build and no bundler, so a call that
 * got as far as rendering would fail on those rather than answer — each result
 * here was decided ahead of the render. The sweep itself, in a browser, is
 * `check-components.e2e.test.ts`.
 */
type Result = { isError?: true; content: { type: string; text?: string }[] };
type Handler = (args: Record<string, unknown>) => Promise<Result>;

const SHADCN_HOST = join(import.meta.dir, "../../../__tests__/fixtures/shadcn-host");

let t: TestContext | undefined;
const temps: string[] = [];

afterEach(async () => {
  await t?.cleanup();
  t = undefined;
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function tools(
  options: TestContextOptions,
  opts: { repo?: boolean; jit?: Partial<TailwindJit> } = {},
): Promise<Record<string, Handler>> {
  const folder = await testContext({ label: "check-components", ...options });
  t = folder;
  if (opts.repo !== false) {
    folder.ctx.repo = createRepoComponents(folder.folder, folder.ctx.providers);
  }
  const handlers: Record<string, Handler> = {};
  registerRepoTools(
    {
      registerTool: (name: string, _config: unknown, cb: Handler) => {
        handlers[name] = cb;
      },
    } as unknown as McpServer,
    folder.ctx,
    (opts.jit ?? {}) as TailwindJit,
    {} as LiveBundler,
    { invalidate: () => {} } as unknown as CanvasBundler,
  );
  return handlers;
}

const call = async (handlers: Record<string, Handler>, name: string, args = {}) => {
  const handler = handlers[name];
  if (!handler) throw new Error(`${name} was not registered`);
  const result = await handler(args);
  return {
    isError: result.isError === true,
    body: JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>,
  };
};

const noLibrary = (hostRoot: string): TestContextOptions => ({
  provider: createNoneProvider(),
  config: designConfig({
    library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
    styling: { framework: "none" },
    hostApp: { root: hostRoot },
  }),
});

/** An app on disk, from a map of host-relative files. */
async function appWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "velloo-check-app-"));
  temps.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), contents, "utf8");
  }
  return root;
}

async function customApp(): Promise<string> {
  const app = await fixtureApp();
  temps.push(dirname(app.root));
  return app.root;
}

describe("check_components", () => {
  test("an id the app does not give the design is refused by name, with where the ids are", async () => {
    const handlers = await tools(noLibrary(await customApp()));
    const { isError, body } = await call(handlers, "check_components", {
      ids: ["StatCard", "StatCrad", "Button"],
    });
    expect(isError).toBe(true);
    expect(body.kind).toBe("BadRequest");
    // `StatCard` is the app's; the misspelling and the library's own `Button` are not.
    expect(body.message).toContain('"StatCrad", "Button"');
    expect(body.message).not.toContain('"StatCard"');
    expect(body.message).toContain("list_components");
  });

  test("a library component the app keeps a file for is one of its own, by the library's id", async () => {
    const shadcn = (source: "in-repo" | "binary") =>
      tools({
        provider: createUpstreamProvider({
          cacheDir: join(SHADCN_HOST, "src/components"),
          hostAppRoot: SHADCN_HOST,
        }),
        config: designConfig({
          library: {
            id: "shadcn-upstream",
            source,
            componentsPath: source === "binary" ? "binary" : join(SHADCN_HOST, "src/components"),
          },
          hostApp: { root: SHADCN_HOST },
        }),
      });

    // `components/ui/button.tsx` is the app's file, though `Button` is on no
    // Repo shelf: only the component with no file there is turned away.
    const inRepo = await call(await shadcn("in-repo"), "check_components", {
      ids: ["Button", "Accordion"],
    });
    expect(inRepo.isError).toBe(true);
    expect(inRepo.body.message).toContain('"Accordion"');
    expect(inRepo.body.message).not.toContain('"Button"');
    await t?.cleanup();

    // The embedded library has no app file behind it, so there is nothing of the app's to check.
    const binary = await call(await shadcn("binary"), "check_components", { ids: ["Button"] });
    expect(binary.isError).toBe(true);
    expect(binary.body.message).toContain('"Button"');
  });

  test("a library file that exports only the app's renamed component gives the design no library component", async () => {
    const root = await appWith({
      "components.json": JSON.stringify({ aliases: { ui: "@/components/ui" } }),
      "src/components/ui/button.tsx": "export function Button(props: object) { return null; }\n",
      // The app kept shadcn's file name and renamed what it exports.
      "src/components/ui/badge.tsx": "export function StatusChip(props: object) { return null; }\n",
    });
    const handlers = await tools({
      provider: createUpstreamProvider({
        cacheDir: join(root, "src/components"),
        hostAppRoot: root,
      }),
      config: designConfig({
        library: {
          id: "shadcn-upstream",
          source: "in-repo",
          componentsPath: join(root, "src/components"),
        },
        hostApp: { root },
      }),
    });
    const { isError, body } = await call(handlers, "check_components", {
      ids: ["Button", "Badge"],
    });
    expect(isError).toBe(true);
    expect(body.message).toContain('"Badge"');
    expect(body.message).not.toContain('"Button"');
  });

  test("an app with only pages and a router has nothing to check, and is told to compose with the library", async () => {
    const root = await appWith({
      "package.json": JSON.stringify({ dependencies: { react: "*", "react-dom": "*" } }),
      "index.html": '<div id="root"></div><script type="module" src="/src/main.jsx"></script>',
      "src/main.jsx":
        'import { createRoot } from "react-dom/client";\nimport { App } from "./App";\ncreateRoot(document.getElementById("root")).render(<App />);\n',
      "src/App.jsx": "export function App() {\n  return <main>Reports</main>;\n}\n",
    });
    const { isError, body } = await call(await tools(noLibrary(root)), "check_components");
    expect(isError).toBe(false);
    expect(body.checked).toBe(0);
    expect(body.note).toContain("no components of its own to check");
    expect(body.note).toContain("nothing here needs a preview entry");
  });

  test("a host app that is not configured is refused, not reported as having no components", async () => {
    const handlers = await tools(noLibrary(await customApp()));
    const { isError, body } = await call(handlers, "check_components", { app: "admin" });
    expect(isError).toBe(true);
    expect(body).toMatchObject({ kind: "BadRequest" });
    expect(body.message).toContain('No host app "admin"');
  });

  test("a render that cannot be built is a RenderFailed answer carrying the cause", async () => {
    const handlers = await tools(noLibrary(await customApp()), {
      jit: {
        build: async () => {
          throw new Error("theme/custom.css: unexpected }");
        },
      },
    });
    const { isError, body } = await call(handlers, "check_components", { ids: ["StatCard"] });
    expect(isError).toBe(true);
    expect(body).toEqual({ kind: "RenderFailed", message: "theme/custom.css: unexpected }" });
  });

  test("a session with no app catalog says so", async () => {
    const handlers = await tools({}, { repo: false });
    for (const name of ["check_components", "preview_status"]) {
      const { isError, body } = await call(handlers, name);
      expect(isError).toBe(true);
      expect(body.message).toBe("This session has no repository-component catalog.");
    }
  });
});

describe("set_preview_entry", () => {
  const previewFiles = async () =>
    (await readdir(t?.root ?? "")).filter((name) => name.startsWith("preview."));

  test("with no source and no app to suggest one from, asks for the source and writes nothing", async () => {
    const handlers = await tools({}, { repo: false });
    const { isError, body } = await call(handlers, "set_preview_entry");
    expect(isError).toBe(true);
    expect(body.message).toContain("Pass `source`");
    expect(await previewFiles()).toEqual([]);
  });

  test("a module with no default export is refused before it replaces a working entry", async () => {
    const handlers = await tools(noLibrary(await customApp()));
    const { isError, body } = await call(handlers, "set_preview_entry", {
      source: "export const Preview = ({ children }) => children;\n",
    });
    expect(isError).toBe(true);
    expect(body.message).toContain("needs a default export");
    expect(await previewFiles()).toEqual([]);
  });

  test("an entry for an app the design does not have is refused, and no file is left behind", async () => {
    const handlers = await tools(noLibrary(await customApp()));
    const { isError, body } = await call(handlers, "set_preview_entry", {
      app: "admin",
      source: "export default ({ children }) => children;\n",
    });
    expect(isError).toBe(true);
    expect(body.message).toContain('No host app "admin"');
    expect(await previewFiles()).toEqual([]);
    expect(t?.events).toEqual([]);
  });
});
