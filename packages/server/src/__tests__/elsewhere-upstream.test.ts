import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createProvider as createUpstreamProvider } from "@velloo/provider-shadcn-upstream";
import { renderScreen } from "@velloo/renderer";
import { ScreenSchema } from "@velloo/schema";
import { designTheme } from "../testing/design-folder.ts";

/** Every shipped screen must resolve against the upstream provider. */

const elsewhereRoot = resolve(import.meta.dir, "../../../cli/src/scaffold/elsewhere");

const sampleTheme = designTheme({ name: "elsewhere-test" });

async function loadSnippets(): Promise<Map<string, import("@velloo/schema").Snippet>> {
  const snippetsDir = resolve(elsewhereRoot, "snippets");
  const files = (await readdir(snippetsDir)).filter((f) => f.endsWith(".json"));
  const out = new Map<string, import("@velloo/schema").Snippet>();
  for (const f of files) {
    const raw = JSON.parse(await readFile(resolve(snippetsDir, f), "utf8"));
    out.set(raw.id, raw);
  }
  return out;
}

describe("Elsewhere renders against shadcn-upstream", () => {
  /**
   * Read off the render's `failures` rather than a throw: the guard now stands
   * in for a `$ref` it can't resolve, so a screen referencing a component
   * nobody registered renders perfectly happily — with a dashed box where the
   * component should be, which is exactly what a scaffold must never ship.
   */
  test("every Elsewhere screen mounts with no component missing or throwing", async () => {
    const provider = createUpstreamProvider();
    const snippets = await loadSnippets();
    const screensDir = resolve(elsewhereRoot, "screens");
    const files = (await readdir(screensDir)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);

    const failures: { screen: string; ref?: string; error: string }[] = [];
    for (const f of files) {
      const raw = JSON.parse(await readFile(resolve(screensDir, f), "utf8"));
      const screen = ScreenSchema.parse(raw);
      try {
        const { bodyHtml, failures: stoodIn } = await renderScreen(screen, sampleTheme, {
          viewport: { w: 1440, h: 900 },
          snapshotCss: "",
          registry: provider.registry,
          snippets,
        });
        expect(bodyHtml.length).toBeGreaterThan(0);
        for (const failure of stoodIn) {
          failures.push({
            screen: screen.id,
            ref: failure.componentId,
            error:
              failure.kind === "missing"
                ? `Elsewhere references "${failure.componentId}" — add it to the upstream provider's registry.`
                : `Elsewhere's "${failure.componentId}" threw: ${failure.reason}`,
          });
        }
      } catch (err) {
        failures.push({
          screen: screen.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    expect(failures).toEqual([]);
  });
});
