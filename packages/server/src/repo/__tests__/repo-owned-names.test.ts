import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProvider as createShadcnProvider } from "@velloo/provider-shadcn-upstream";
import { designConfig, type TestContext, testContext } from "../../testing/design-folder.ts";
import type { RepoComponents } from "../catalog.ts";
import { createRepoComponents } from "../store.ts";

/**
 * A shadcn app's `ui/` directory is the adapter's, but only for the names the
 * adapter takes from each file. An app that exports its own labelled `Field`
 * from `input.tsx`, with no `field.tsx` installed, has a component the library
 * never mounts — hiding it as "the provider's" left the agent the bundled
 * `Field` instead of the app's.
 */
let app: string;
let t: TestContext;
let repo: RepoComponents;

beforeAll(async () => {
  app = await realpath(await mkdtemp(join(tmpdir(), "velloo-owned-names-")));
  await mkdir(join(app, "components/ui"), { recursive: true });
  await mkdir(join(app, "app"), { recursive: true });
  await writeFile(join(app, "package.json"), JSON.stringify({ name: "owned-names-app" }));
  await writeFile(
    join(app, "components/ui/input.tsx"),
    [
      "export function Input(props: { placeholder?: string }) { return <input {...props} />; }",
      "export function Field({ label, children }: { label: string; children?: React.ReactNode }) {",
      "  return <label>{label}{children}</label>;",
      "}",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(app, "app/page.tsx"),
    [
      'import { Field, Input } from "../components/ui/input";',
      "export default function Page() {",
      '  return <Field label="Vessel"><Input placeholder="IMO" /></Field>;',
      "}",
      "",
    ].join("\n"),
  );
  t = await testContext({
    provider: createShadcnProvider({ hostAppRoot: app }),
    config: designConfig({ hostApp: { root: app } }),
  });
  repo = createRepoComponents(t.folder, t.ctx.providers);
});

afterAll(async () => {
  await t.cleanup();
  await rm(app, { recursive: true, force: true });
});

describe("names an adapter-owned directory shares with the library", () => {
  test("the app's own export is cataloged, qualified; the library's own file stays owned", async () => {
    const catalog = await repo.catalog();
    const ids = catalog.entries.map((entry) => entry.id);
    expect(ids).toContain("App.Field");
    expect(catalog.byId.get("App.Field")?.identity).toMatchObject({ exportName: "Field" });
    expect(catalog.byId.get("App.Field")?.props.map((prop) => prop.name)).toContain("label");
    // `Input` in `input.tsx` is exactly what the adapter mounts for `Input`.
    expect(ids.some((id) => id === "Input" || id.endsWith(".Input"))).toBe(false);
  });
});
