import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createProvider as createUpstreamProvider } from "@velloo/provider-shadcn-upstream";
import { renderScreen, UnknownComponentError } from "@velloo/renderer";
import { ScreenSchema } from "@velloo/schema";
import { designTheme } from "../testing/design-folder.ts";

/**
 * Sanity: every Pulse screen renders without throwing against
 * the upstream provider. Pulse uses ~all of shadcn's surface; if any
 * component id falls outside the provider's registry, this test
 * surfaces it as a clear "Pulse references X" failure rather than
 * waiting for someone to hit it in the canvas.
 *
 * The upstream provider's runtime registry currently re-uses the
 * snapshot's components, so this test is effectively a rerun of the
 * legacy snapshot's render coverage with a different provider identity
 * attached.
 */

const pulseRoot = resolve(import.meta.dir, "../../../cli/src/scaffold/pulse");

const sampleTheme = designTheme({ name: "pulse-test" });

async function loadSnippets(): Promise<Map<string, import("@velloo/schema").Snippet>> {
  const snippetsDir = resolve(pulseRoot, "snippets");
  const files = (await readdir(snippetsDir)).filter((f) => f.endsWith(".json"));
  const out = new Map<string, import("@velloo/schema").Snippet>();
  for (const f of files) {
    const raw = JSON.parse(await readFile(resolve(snippetsDir, f), "utf8"));
    out.set(raw.id, raw);
  }
  return out;
}

describe("Pulse renders against shadcn-upstream", () => {
  test("every Pulse screen mounts without an UnknownComponentError", async () => {
    const provider = createUpstreamProvider();
    const snippets = await loadSnippets();
    const screensDir = resolve(pulseRoot, "screens");
    const files = (await readdir(screensDir)).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);

    const failures: { screen: string; ref?: string; error: string }[] = [];
    for (const f of files) {
      const raw = JSON.parse(await readFile(resolve(screensDir, f), "utf8"));
      const screen = ScreenSchema.parse(raw);
      try {
        const { bodyHtml } = await renderScreen(screen, sampleTheme, {
          viewport: { w: 1440, h: 900 },
          snapshotCss: "",
          registry: provider.registry,
          snippets,
        });
        expect(bodyHtml.length).toBeGreaterThan(0);
      } catch (err) {
        if (err instanceof UnknownComponentError) {
          failures.push({
            screen: screen.id,
            ref: err.ref,
            error: `Pulse references "${err.ref}" — add it to the upstream provider's registry.`,
          });
        } else {
          failures.push({
            screen: screen.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
