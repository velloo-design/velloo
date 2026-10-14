import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Theme } from "@velloo/schema";
import { PNG } from "pngjs";
import { createServer, type ServerHandle } from "../index.ts";
import { fixtureApp } from "../repo/__tests__/fixture-app.ts";
import {
  type DesignConfigOverrides,
  designConfig,
  scaffoldDesignFolder,
} from "../testing/design-folder.ts";

/**
 * `check_components` end to end: the daemon plans the sweep, a real browser
 * mounts the app's components inside the preview entry, and the verdict comes
 * back over MCP. The plan and the verdict are pure and tested beside
 * `sweep.ts`; this is the part between them — that what the browser drew is
 * what gets judged. Opt-in like every browser suite: `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

interface Finding {
  id: string;
  status: string;
  code?: string;
  remedy?: string;
  flags?: string[];
  detail?: string;
}

interface Report {
  kind?: string;
  message?: string;
  app?: string;
  dark?: boolean;
  mounted: boolean;
  note?: string;
  checked: number;
  ok: string[];
  problems: Finding[];
  inconclusive?: Finding[];
  notChecked?: string[];
  notCheckedNote?: string;
  partsNote?: string;
  sheets: number;
  next: string;
}

type Content = { type: string; text?: string; data?: string; mimeType?: string }[];

interface Site {
  app: Awaited<ReturnType<typeof fixtureApp>>;
  folder: Awaited<ReturnType<typeof scaffoldDesignFolder>>;
  server: ServerHandle;
  client: Client;
}

interface SiteOptions {
  /** Change the app before the daemon reads it. */
  prepare?: (appRoot: string) => Promise<void>;
  theme?: Partial<Theme>;
  /** The design's library, given the app's root; default no library, inline styles. */
  config?: (appRoot: string) => DesignConfigOverrides;
}

async function open(options: SiteOptions = {}): Promise<Site> {
  const app = await fixtureApp();
  await options.prepare?.(app.root);
  const folder = await scaffoldDesignFolder({
    label: "check-components",
    theme: options.theme ?? {},
    config: designConfig({
      ...(options.config?.(app.root) ?? {
        library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
        styling: { framework: "none" },
      }),
      hostApp: { root: app.root },
    }),
  });
  const server = await createServer({
    folder: folder.root,
    port: 0,
    mcp: { transport: "http", port: 0 },
  });
  const client = new Client({ name: "check-components-e2e", version: "0.0.0" });
  const url = new URL(server.mcpUrl ?? "");
  url.searchParams.set("surface", "full");
  // The SDK's own transport type disagrees with `Transport` under
  // exactOptionalPropertyTypes (see mcp-wiring.test.ts).
  await client.connect(
    new StreamableHTTPClientTransport(url) as Parameters<typeof client.connect>[0],
  );
  return { app, folder, server, client };
}

async function close(site: Site | undefined): Promise<void> {
  await site?.client.close();
  await site?.server.close();
  await site?.folder.cleanup();
  await site?.app.cleanup();
}

async function check(site: Site, args: Record<string, unknown> = {}) {
  const result = await site.client.callTool({ name: "check_components", arguments: args });
  const content = result.content as Content;
  const report = JSON.parse(content.find((part) => part.type === "text")?.text ?? "{}") as Report;
  const sheets = content
    .filter((part) => part.type === "image")
    .map((part) => PNG.sync.read(Buffer.from(part.data ?? "", "base64")));
  return { report, sheets, isError: result.isError === true };
}

/** The preview entry the fixture app needs: its stylesheet and its provider. */
function previewEntry(site: Pick<Site, "app" | "folder">, withStylesheet = true): string {
  const toApp = relative(site.folder.root, site.app.root);
  return [
    ...(withStylesheet ? [`import ${JSON.stringify(join(toApp, "src/styles.css"))};`] : []),
    `import { ThemeProvider } from ${JSON.stringify(join(toApp, "src/components/theme"))};`,
    "export default function Preview({ children }) {",
    '  return <ThemeProvider accent="violet">{children}</ThemeProvider>;',
    "}",
  ].join("\n");
}

/** Swap the preview entry through the tool, which drops the daemon's caches as it writes. */
async function useEntry(site: Site, source: string): Promise<void> {
  const result = await site.client.callTool({ name: "set_preview_entry", arguments: { source } });
  if (result.isError) throw new Error(`the preview entry was refused: ${JSON.stringify(result)}`);
}

const problem = (report: Report, id: string) => report.problems.find((entry) => entry.id === id);

describe.skipIf(!RUN)("check_components in a real browser", () => {
  let site: Site;

  beforeAll(async () => {
    site = await open({
      theme: { colorsDark: { background: "oklch(0.15 0 0)", foreground: "oklch(0.98 0 0)" } },
      // A compound written the shadcn way: a root and a flat-named part of it.
      prepare: async (appRoot) => {
        await writeFile(
          join(appRoot, "src/components/deck.jsx"),
          [
            "export function Deck({ children }) {",
            '  return <section className="fx-card">{children}</section>;',
            "}",
            "export function DeckBody({ children }) {",
            "  return <p>{children}</p>;",
            "}",
            "",
          ].join("\n"),
        );
        const entry = join(appRoot, "src/App.jsx");
        await writeFile(
          entry,
          (await readFile(entry, "utf8"))
            .replace(
              "<EnvBadge />",
              "<EnvBadge />\n      <Deck>\n        <DeckBody>Body</DeckBody>\n      </Deck>",
            )
            .replace(
              "import { Broken }",
              'import { Deck, DeckBody } from "./components/deck";\nimport { Broken }',
            ),
        );
      },
    });
  }, 60_000);
  afterAll(() => close(site));

  test("sweeps every component of the app's own and sorts them into trustworthy and not", async () => {
    await useEntry(site, previewEntry(site));
    const { report, sheets, isError } = await check(site);
    expect(isError).toBe(false);
    expect(report.mounted).toBe(true);
    expect(report.note).toBeUndefined();
    expect(report.checked).toBe(11);
    // Drawn from the app's source, at the props its call sites pass. `Unused`
    // is exported and never rendered by the app, so there is nothing to mount it as.
    expect([...report.ok].sort()).toEqual(
      [
        "Deck",
        "EnvBadge",
        "Hero",
        "Panel",
        "RegionTag",
        "StatCard",
        "Steps",
        "ThemedButton",
      ].sort(),
    );
    // A part is not mounted outside its root, and the report says how many were left for that.
    expect(report.partsNote).toMatch(/^1 part of other components .* was not mounted alone/);
    expect(report.problems.map((entry) => entry.id).sort()).toEqual(["Badge", "Broken", "Overlay"]);
    // A module that does not compile is named with its code and remedy.
    expect(problem(report, "Broken")).toMatchObject({
      status: "unavailable",
      code: "compile-failed",
    });
    expect(problem(report, "Broken")?.remedy).toBeTruthy();
    // It mounted, and portals what it draws to the body: nothing where it sits.
    expect(problem(report, "Overlay")).toMatchObject({ status: "exact", flags: ["blank"] });
    // Nothing in the app styles `data-variant`, so both values really do draw alike.
    expect(problem(report, "Badge")).toMatchObject({
      status: "exact",
      flags: ["variantsIdentical"],
    });
    expect(problem(report, "Badge")?.detail).toContain('`variant="outline"` and `variant="solid"`');
    expect(report.inconclusive).toBeUndefined();
    expect(report.notChecked).toBeUndefined();
    expect(report.next).toContain("re-run with `ids`");

    // One contact sheet for the eleven, two columns wide at three-quarter scale.
    expect(report.sheets).toBe(1);
    expect(sheets).toHaveLength(1);
    expect(sheets[0]?.width).toBe(1200);
    expect(sheets[0]?.height).toBeGreaterThan(300);
  }, 120_000);

  test("a stylesheet the preview entry never loaded shows up as variants that draw alike", async () => {
    // The fill for `tone="positive"` lives in the app's styles.css. Without it
    // the component still mounts cleanly — `exact` — and only the pair gives it away.
    await useEntry(site, previewEntry(site, false));
    const without = await check(site, { ids: ["StatCard", "ThemedButton"], image: false });
    expect(without.report.ok).toEqual(["ThemedButton"]);
    expect(problem(without.report, "StatCard")).toMatchObject({
      status: "exact",
      flags: ["variantsIdentical"],
    });
    expect(problem(without.report, "StatCard")?.detail).toContain('`tone="positive"`');
    expect(problem(without.report, "StatCard")?.detail).toContain("preview_status");

    await useEntry(site, previewEntry(site));
    const loaded = await check(site, { ids: ["StatCard", "ThemedButton"], image: false });
    expect(loaded.report.ok).toEqual(["StatCard", "ThemedButton"]);
    expect(loaded.report.problems).toEqual([]);
    expect(loaded.report.next).toContain("Every component checked renders from the app's source");
  }, 120_000);

  test("`ids` re-checks a few at full size, and `image: false` returns the verdict alone", async () => {
    await useEntry(site, previewEntry(site));
    const few = await check(site, { ids: ["StatCard", "Hero"] });
    expect(few.report.checked).toBe(2);
    expect(few.report.ok).toEqual(["StatCard", "Hero"]);
    expect(few.sheets).toHaveLength(1);
    expect(few.sheets[0]?.width).toBe(1600);

    const quiet = await check(site, { ids: ["StatCard"], image: false });
    expect(quiet.report).toMatchObject({ checked: 1, ok: ["StatCard"], sheets: 1 });
    expect(quiet.sheets).toEqual([]);
    // Asked for by id, nothing was left out, so there is no note about parts —
    // and a part named outright is mounted like anything else.
    expect(quiet.report.partsNote).toBeUndefined();
    const part = await check(site, { ids: ["DeckBody"], image: false });
    expect(part.report).toMatchObject({ checked: 1, ok: ["DeckBody"] });
  }, 120_000);

  test("`dark` sweeps the dark theme", async () => {
    await useEntry(site, previewEntry(site));
    // A pixel inside the sheet's own padding: the theme's background in each mode.
    const luminance = (png: PNG | undefined) => {
      const at = png ? (png.width * 20 + 100) * 4 : 0;
      return ((png?.data[at] ?? 0) + (png?.data[at + 1] ?? 0) + (png?.data[at + 2] ?? 0)) / 3;
    };
    const light = await check(site, { ids: ["Hero"] });
    const dark = await check(site, { ids: ["Hero"], dark: true });
    expect(light.report.dark).toBeUndefined();
    expect(dark.report.dark).toBe(true);
    expect(dark.report.ok).toEqual(["Hero"]);
    expect(luminance(light.sheets[0])).toBeGreaterThan(240);
    expect(luminance(dark.sheets[0])).toBeLessThan(60);
  }, 120_000);

  test("an entry that does not compile mounts nothing, and the report says to fix that first", async () => {
    await useEntry(
      site,
      "export default function Preview({ children }) {\n  return <Unclosed>{children};\n}\n",
    );
    const { report, sheets } = await check(site, { ids: ["StatCard", "Hero"] });
    expect(report.mounted).toBe(false);
    expect(report.note).toContain("Nothing mounted");
    // Named where it is, not "no reason given": the bundler alone says only "Syntax Error".
    expect(report.note).toMatch(
      /\(the preview entry does not compile: Syntax Error at preview\.tsx:2:\d+ \(`return <Unclosed>\{children\};`\)\)/,
    );
    expect(report.note).toContain("Fix the preview entry first (preview_status)");
    // Nothing is called trustworthy on the strength of the server's stand-ins.
    expect(report.ok).toEqual([]);
    expect(report.problems).toEqual([
      { id: "StatCard", status: "unchecked" },
      { id: "Hero", status: "unchecked" },
    ]);
    // The sheet still comes back: what was drawn instead is worth seeing.
    expect(sheets).toHaveLength(1);
    // preview_status, where the note sends the agent, names the same line.
    const status = await site.client.callTool({ name: "preview_status", arguments: {} });
    const text = (status.content as Content).find((part) => part.type === "text")?.text ?? "{}";
    const body = JSON.parse(text) as { state: string; probe?: { previewError?: string } };
    expect(body.state).toBe("failing");
    expect(body.probe?.previewError).toContain(
      "the preview entry does not compile: Syntax Error at preview.tsx:2:",
    );
  }, 120_000);
});

describe.skipIf(!RUN)("check_components before the design is set up", () => {
  let site: Site;

  beforeAll(async () => {
    site = await open();
  }, 60_000);
  afterAll(() => close(site));

  test("names the component waiting on a provider; the suggested preview entry then supplies it", async () => {
    const before = await check(site, { image: false });
    expect(before.report.mounted).toBe(true);
    expect(problem(before.report, "ThemedButton")).toMatchObject({
      status: "unavailable",
      code: "missing-provider",
    });
    // Its neighbours need no provider and are unaffected.
    expect(before.report.ok).toContain("Hero");

    // No `source`: the entry is written from what the app's own entry does.
    const written = await site.client.callTool({ name: "set_preview_entry", arguments: {} });
    const status = JSON.parse((written.content as Content)[0]?.text ?? "{}") as {
      state: string;
      preview: { kind: string; path: string; label: string };
    };
    expect(status.preview).toEqual({ kind: "file", path: "preview.tsx", label: "preview.tsx" });
    const source = await readFile(join(site.folder.root, "preview.tsx"), "utf8");
    expect(source).toContain("styles.css");
    expect(source).toContain('<ThemeProvider accent="violet">');
    expect(status.state).toBe("valid");

    const after = await check(site, { image: false });
    expect(after.report.ok).toContain("ThemedButton");
    expect(after.report.ok).toContain("StatCard");
  }, 120_000);
});

describe.skipIf(!RUN)(
  "check_components on an app with more components than one call mounts",
  () => {
    const COUNT = 125;
    const name = (at: number) => `Part${String(at).padStart(3, "0")}`;
    const names = Array.from({ length: COUNT }, (_, at) => name(at + 1));
    let site: Site;

    beforeAll(async () => {
      site = await open({ prepare });
    }, 60_000);
    afterAll(() => close(site));

    async function prepare(appRoot: string): Promise<void> {
      await writeFile(
        join(appRoot, "src/components/parts.jsx"),
        names
          .map(
            (id) =>
              `export function ${id}({ label }) {\n  return <div data-part="${id}">{label}</div>;\n}\n`,
          )
          .join("\n"),
      );
      await writeFile(
        join(appRoot, "src/App.jsx"),
        [
          `import { ${names.join(", ")} } from "./components/parts";`,
          "export function App() {",
          "  return (",
          "    <main>",
          ...names.map((id) => `      <${id} label="${id}" />`),
          "    </main>",
          "  );",
          "}",
          "",
        ].join("\n"),
      );
      await writeFile(
        join(appRoot, "src/main.jsx"),
        'import { createRoot } from "react-dom/client";\nimport { App } from "./App";\ncreateRoot(document.getElementById("root")).render(<App />);\n',
      );
    }

    test("twenty to a sheet, six sheets to a call, and the rest named for a second call", async () => {
      const { report, sheets } = await check(site);
      expect(report.mounted).toBe(true);
      expect(report.checked).toBe(120);
      expect(report.ok).toEqual(names.slice(0, 120));
      expect(report.problems).toEqual([]);
      expect(report.sheets).toBe(6);
      expect(sheets).toHaveLength(6);
      expect(report.notChecked).toEqual(names.slice(120));
      expect(report.notCheckedNote).toContain("120 is the most one call mounts");

      const rest = await check(site, { ids: report.notChecked, image: false });
      expect(rest.report.checked).toBe(5);
      expect(rest.report.ok).toEqual(names.slice(120));
      expect(rest.report.sheets).toBe(1);
      expect(rest.report.notChecked).toBeUndefined();
    }, 240_000);
  },
);

describe.skipIf(!RUN)("check_components on a shadcn app", () => {
  let site: Site;

  // The app's own copy of the library's Button, with a variant upstream has not.
  const BUTTON = `import type { ButtonHTMLAttributes } from "react";

const buttonVariants = {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground",
      launch: "bg-foreground text-background",
    },
  },
  defaultVariants: { variant: "default" },
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "launch";
}

export function Button({ variant = "default", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      data-host-button="true"
      className={[buttonVariants.variants.variant[variant], "px-4 py-2", className].join(" ")}
    />
  );
}
`;

  beforeAll(async () => {
    site = await open({
      prepare: async (appRoot) => {
        await mkdir(join(appRoot, "src/components/ui"), { recursive: true });
        await writeFile(join(appRoot, "src/components/ui/button.tsx"), BUTTON);
      },
      config: (appRoot) => ({
        library: {
          id: "shadcn-upstream",
          source: "in-repo",
          componentsPath: join(appRoot, "src/components"),
        },
      }),
    });
  }, 60_000);
  afterAll(() => close(site));

  test("the library components the app keeps files for are swept with its own", async () => {
    const { report } = await check(site, { image: false });
    expect(report.mounted).toBe(true);
    // `Button` is the library's by name and on no Repo shelf, but the file is
    // the app's: it is mounted from that file, after the app's own components,
    // and its two variants — one of them the app's addition — draw differently.
    expect(report.ok).toContain("Button");
    expect(report.ok.indexOf("Button")).toBeGreaterThan(report.ok.indexOf("Hero"));
    expect(report.checked).toBe(11);
    // The app's `Badge` shares a name with the library's, so it is checked
    // under the qualified id an agent composes it by.
    expect(problem(report, "App.Badge")).toMatchObject({ flags: ["variantsIdentical"] });

    const one = await check(site, { ids: ["Button"], image: false });
    expect(one.report).toMatchObject({ checked: 1, ok: ["Button"], problems: [] });
  }, 120_000);
});
