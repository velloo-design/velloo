import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  componentsOnDisk,
  coverageProblems,
  declarationProblems,
  pinDrift,
  render,
  repoRoot,
  type VendorTarget,
} from "../vendor-shadcn/pipeline.ts";
import { TARGETS } from "../vendor-shadcn/targets.ts";

const EACH_TARGET = TARGETS.map((t) => [t.id, t] as const);

async function sources(target: VendorTarget): Promise<{ id: string; source: string }[]> {
  const dir = join(repoRoot, target.packageDir, target.uiDir);
  return Promise.all(
    (await componentsOnDisk(target)).map(async (id) => ({
      id,
      source: await readFile(join(dir, `${id}.tsx`), "utf8"),
    })),
  );
}

function target(id: string): VendorTarget {
  const found = TARGETS.find((t) => t.id === id);
  if (!found) throw new Error(`no such vendor target: ${id}`);
  return found;
}

const SNAPSHOT = target("snapshot");
const CHROME = target("chrome");

describe("the shadcn vendoring pipeline", () => {
  /**
   * One pin, stamped into every target by the pull. Before the pipeline was
   * shared the two copies each carried their own, and they drifted a full style
   * apart — the snapshot on radix-nova at 55 components while the chrome sat on
   * new-york at 21, so every family a pull added was simply unavailable in the
   * product and nothing went red. Checked against `SHADCN_PIN` rather than
   * between the packages, so two copies stamped by an older pull fail too.
   */
  test.each(EACH_TARGET)("%s records the pull the pipeline took", async (_id, t) => {
    expect(await pinDrift(t)).toEqual([]);
    // A stamp nothing reads is a second place for the pin to go stale.
    if (!t.recordsPullDate) {
      const pkg = JSON.parse(
        await readFile(join(repoRoot, t.packageDir, "package.json"), "utf8"),
      ) as Record<string, unknown>;
      expect(pkg.snapshotVersion).toBeUndefined();
    }
  });

  /**
   * The catalog is the declared set, not a description of whatever happens to
   * be on disk: `registryDependencies` are checked against it rather than
   * silently expanding it, and a file nobody declared is reported as an orphan.
   * The snapshot used to vendor "every .tsx already in the directory", which
   * cannot notice a component that was never added in the first place.
   */
  test.each(EACH_TARGET)(
    "%s carries exactly the components its catalog declares",
    async (_id, t) => {
      expect(await componentsOnDisk(t)).toEqual([...t.catalog].sort());
    },
  );

  /**
   * Each id decided once, and a divergence or patch only on a component the
   * target carries. A patch on an `adapted` file is the subtle one: a routine
   * pull never writes that file, so the patch would sit unapplied and
   * unchecked until someone ran `--force`.
   */
  test.each(EACH_TARGET)("%s declares a coherent catalog", (_id, t) => {
    expect(declarationProblems(t)).toEqual([]);
    for (const [id, reason] of Object.entries(t.skipped)) {
      expect(reason.length, `${id} is skipped without saying why`).toBeGreaterThan(20);
    }
  });

  test("rejects a patch aimed at an adapted file", () => {
    const patched: VendorTarget = {
      ...CHROME,
      patches: { slider: [{ find: "value={value}", replace: "" }] },
    };
    expect(declarationProblems(patched)).toEqual([
      "slider: patched, but adapted — carry the fix in the file itself",
    ]);
  });

  /**
   * Coverage runs both ways against upstream's index: a family upstream adds
   * must be decided, and one it drops must not linger as a skip reason nobody
   * can check.
   */
  test("checks the catalog against upstream in both directions", () => {
    const served = new Set([...CHROME.catalog, ...Object.keys(CHROME.skipped)]);
    expect(coverageProblems(CHROME, served)).toEqual([]);

    const added = coverageProblems(CHROME, new Set([...served, "brand-new"]));
    expect(added).toHaveLength(1);
    expect(added[0]).toContain("neither carries nor skips: brand-new");

    const dropped = new Set(served);
    dropped.delete("pagination");
    const gone = coverageProblems(CHROME, dropped);
    expect(gone).toHaveLength(1);
    expect(gone[0]).toContain("no longer served upstream: pagination");
  });

  test("merges collapsed icons into a file's own lucide import", () => {
    const content = [
      '"use client"',
      "",
      'import * as React from "react"',
      'import { XIcon } from "lucide-react"',
      'import { cn } from "cn"',
      "",
      'export const A = () => <IconPlaceholder lucide="ChevronDownIcon" tabler="IconChevronDown" />',
      "",
    ].join("\n");
    const out = render(CHROME, "button", { files: [{ content }] });

    expect(out.match(/from "lucide-react"/g)).toHaveLength(1);
    expect(out).toContain('import { ChevronDownIcon, XIcon } from "lucide-react";');
    expect(out).toContain("<ChevronDownIcon />");
  });

  /**
   * Every divergence is declared in the target's `adapted` set, so a routine
   * pull skips the file instead of reverting it. A hand-edit that isn't listed
   * there is silently lost the next time someone runs `bun run vendor` — which
   * is the whole reason the set exists rather than a convention.
   *
   * The two copies announce a divergence differently in prose (the snapshot's
   * shims are "Canvas-safe:", the chrome's are "ADAPTED:"), so both spellings
   * count.
   */
  test.each(EACH_TARGET)(
    "%s declares every file it hand-edited, in both directions",
    async (_id, t) => {
      const marker = /\bADAPTED\b|Canvas-safe:/;
      const announced = (await sources(t))
        .filter(({ source }) => marker.test(source))
        .map((f) => f.id);

      expect(announced.sort()).toEqual([...t.adapted].sort());
    },
  );
});

describe("the two copies stay different in the way that matters", () => {
  /**
   * The snapshot's overlays are the canvas-safe contract, not a backlog: a real
   * Radix portal escapes the design iframe to the document root, where the
   * canvas can neither lay it out nor let anyone select it. Each overlay family
   * renders its content inline and pinned open through `canvas-portal.tsx`
   * instead, so consolidating the pull must never turn one of these back into a
   * clean upstream copy.
   */
  test("the design-mode fork renders its overlays inline", async () => {
    const overlays = [
      "alert-dialog",
      "combobox",
      "context-menu",
      "dialog",
      "drawer",
      "dropdown-menu",
      "hover-card",
      "menubar",
      "popover",
      "select",
      "sheet",
      "tooltip",
    ];
    const inlined = (await sources(SNAPSHOT))
      .filter(({ source }) => source.includes("canvas-portal"))
      .map((f) => f.id);

    expect(inlined.sort()).toEqual(overlays.sort());
    for (const id of overlays) expect(SNAPSHOT.adapted).toContain(id);
  });

  /**
   * And the chrome's are real shadcn: the IDE's dialogs open and close, its
   * menus portal to the document root, its toaster is live. Nothing here may
   * reach for the fork's inline stubs — an always-open dialog in the IDE is
   * what that would look like.
   */
  test("the IDE chrome keeps real portals", async () => {
    const files = await sources(CHROME);
    expect(files.filter(({ source }) => source.includes("canvas-portal")).map((f) => f.id)).toEqual(
      [],
    );
    for (const id of ["dialog", "popover", "select", "tooltip", "alert-dialog", "dropdown-menu"]) {
      const file = files.find((f) => f.id === id);
      expect(file?.source, `${id} should portal`).toMatch(/\.Portal\b/);
    }
  });

  /**
   * The snapshot's divergences are its reason to exist, so the set is large by
   * design. The chrome's are bugs or accessibility fixes upstream hasn't taken,
   * and each one is a file that stops tracking upstream — a wrapper in
   * `src/components/` is nearly always the better answer, so the set is capped
   * low enough that growing it is a decision rather than a habit.
   */
  test("the chrome's divergences stay the exception", () => {
    expect(CHROME.adapted.size).toBeLessThanOrEqual(6);
    expect(SNAPSHOT.adapted.size).toBeGreaterThan(CHROME.adapted.size);
  });

  /**
   * AGENTS.md forbids the canvas depending on `@velloo/shadcn-snapshot` or
   * `@velloo/helpers` outright — the chrome would inherit design-mode
   * behaviour, and the two would stop being independently pullable.
   */
  test("the canvas takes no dependency on the fork", async () => {
    const pkg = JSON.parse(
      await readFile(join(repoRoot, CHROME.packageDir, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });

    expect(declared).not.toContain("@velloo/shadcn-snapshot");
    expect(declared).not.toContain("@velloo/helpers");
  });
});
