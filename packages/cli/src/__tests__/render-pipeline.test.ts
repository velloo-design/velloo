import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Screen } from "@velloo/schema";
import { designConfig, scaffoldDesignFolder } from "@velloo/server/testing";
import { loadPipeline } from "../render-pipeline.ts";

/**
 * A one-shot capture mounts the host's live component for real, so its classes
 * have to be in the folder's compiled CSS — and a utility used only inside that
 * component appears in no screen, so only a JIT that scans the host's source
 * dirs ever emits it.
 */

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function liveFolder() {
  const host = await mkdtemp(join(tmpdir(), "velloo-pipeline-host-"));
  cleanups.push(() => rm(host, { recursive: true, force: true }));
  await mkdir(join(host, "src"));
  await writeFile(join(host, "package.json"), JSON.stringify({ name: "host", private: true }));
  await writeFile(
    join(host, "src", "charts.tsx"),
    'export function Sparkline() { return <div className="tracking-[0.4321em]" />; }\n',
  );
  const folder = await scaffoldDesignFolder({
    label: "render-pipeline",
    config: designConfig({
      library: { id: "none", version: "t", source: "binary", componentsPath: "binary" },
      styling: { framework: "tailwind" },
      hostApp: { root: host },
      extensions: {
        Sparkline: {
          importPath: "./src/charts.tsx",
          props: [],
          origin: "manual",
          render: "live",
          fit: "content",
        },
      },
    }),
    screens: {
      home: {
        id: "home",
        name: "Home",
        tree: { $ref: "Box", children: [{ $ref: "Sparkline", props: {} }] },
      } as Screen,
    },
  });
  cleanups.push(() => folder.cleanup());
  return folder;
}

test("a utility used only inside a live component compiles into the capture's CSS", async () => {
  const folder = await liveFolder();
  const pipeline = await loadPipeline(folder.root);
  expect(pipeline.snapshotCss).toContain("0.4321em");
});

test("the live module is built once, however many captures ask", async () => {
  const folder = await liveFolder();
  const pipeline = await loadPipeline(folder.root);
  const first = pipeline.liveModule();
  expect(pipeline.liveModule()).toBe(first);
  await first;
});
