import { describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigSchema } from "@velloo/schema";
import { designSystemConfigPath, designSystemDoc, readDesignSystemDoc } from "../design-system.ts";
import { designConfig, testContext } from "../testing/design-folder.ts";

/**
 * The folder points at its design system document; it never holds a copy.
 *
 * That is the whole design: the file belongs to the repo and goes on being
 * edited there, so a snapshot taken at import time would drift away from the
 * rules it claims to state. Nothing here caches — a `velloo run` session sees
 * whatever the file says at the moment it is asked.
 */

const DESIGN_MD = `---
name: Acme
colors:
  primary: "#4f46e5"
---

## Overview

Calm.

## Do's and Don'ts

- Don't use two accents.
`;

/** What designmd.ai hands out: the spec's sections, no frontmatter at all. */
const PROSE_ONLY = `# Genesis

## Overview

An editorial precision interface.

## Colors

- **Primary** (#6366F1): CTAs, links, focus rings

## Do's and Don'ts

1. **Do** keep spacing on the token scale.
2. **Don't** introduce gradients.
`;

describe("finding the document", () => {
  test("finds a DESIGN.md beside the design folder, with no config at all", async () => {
    const t = await testContext({ label: "ds-convention", nested: true });
    try {
      await writeFile(join(t.root, "..", "DESIGN.md"), DESIGN_MD, "utf8");
      expect(designSystemDoc(t.ctx.folder)?.path).toBe("../DESIGN.md");
    } finally {
      await t.cleanup();
    }
  });

  test("finds a prose-only file — the spec makes frontmatter optional", async () => {
    // This is the shape designmd.ai downloads come in, and the shape Google's
    // own linter accepts with zero errors.
    const t = await testContext({ label: "ds-prose", nested: true });
    try {
      await writeFile(join(t.root, "..", "DESIGN.md"), PROSE_ONLY, "utf8");
      expect(designSystemDoc(t.ctx.folder)).not.toBeNull();
    } finally {
      await t.cleanup();
    }
  });

  test("ignores a DESIGN.md that is an architecture document", async () => {
    // Common filename. Pointing the design agents at someone's database
    // schema would be worse than pointing them at nothing.
    const t = await testContext({ label: "ds-architecture", nested: true });
    try {
      await writeFile(
        join(t.root, "..", "DESIGN.md"),
        "# Design\n\n## Overview\n\nServices.\n\n## Components\n\nAPI, worker.\n\n## Layout\n\nMonorepo.\n",
        "utf8",
      );
      expect(designSystemDoc(t.ctx.folder)).toBeNull();
    } finally {
      await t.cleanup();
    }
  });

  test("an explicit config path wins, resolved from the app root", async () => {
    const t = await testContext({
      label: "ds-configured",
      nested: true,
      config: designConfig({ designSystem: { path: "brand/SYSTEM.md" } }),
    });
    try {
      // No hostApp ⇒ the app root is the folder's parent.
      expect(designSystemDoc(t.ctx.folder)?.path).toBe("../brand/SYSTEM.md");
    } finally {
      await t.cleanup();
    }
  });

  test("a path that would leave the app makes the config invalid", () => {
    // The config is committed; a cloned repo must not be able to aim the
    // design agents at a file outside it.
    for (const path of [
      "/etc/passwd",
      "../../secrets.md",
      "brand/../../x.md",
      "~/notes.md",
      "C:\\x.md",
    ]) {
      expect(ConfigSchema.safeParse(designConfig({ designSystem: { path } })).success).toBe(false);
    }
    expect(
      ConfigSchema.safeParse(designConfig({ designSystem: { path: "docs/DESIGN.md" } })).success,
    ).toBe(true);
  });

  test("a file can be recorded only when it is inside the app root", async () => {
    const t = await testContext({ label: "ds-record", nested: true });
    try {
      const app = join(t.root, "..");
      expect(designSystemConfigPath(t.ctx.folder, join(app, "docs", "DESIGN.md"))).toBe(
        "docs/DESIGN.md",
      );
      expect(designSystemConfigPath(t.ctx.folder, join(app, "..", "DESIGN.md"))).toBeNull();
    } finally {
      await t.cleanup();
    }
  });

  test("finds one at the host app root when the design sits elsewhere in the repo", async () => {
    const t = await testContext({
      label: "ds-host",
      nested: true,
      config: designConfig({ hostApp: { root: "../apps/web" } }),
    });
    try {
      const app = join(t.root, "..", "apps", "web");
      await mkdir(app, { recursive: true });
      await writeFile(join(app, "DESIGN.md"), DESIGN_MD, "utf8");
      expect(designSystemDoc(t.ctx.folder)?.path).toBe("../apps/web/DESIGN.md");
    } finally {
      await t.cleanup();
    }
  });

  test("an app: root with no checkout bound on this machine finds nothing, and does not throw", async () => {
    const t = await testContext({
      label: "ds-unbound",
      nested: true,
      config: designConfig({
        hostApp: { root: "app:web" },
        designSystem: { path: "DESIGN.md" },
      }),
    });
    try {
      expect(designSystemDoc(t.ctx.folder)).toBeNull();
      expect(designSystemConfigPath(t.ctx.folder, join(t.root, "DESIGN.md"))).toBeNull();
    } finally {
      await t.cleanup();
    }
  });

  test("falls back to the folder's own guidance.md for a standalone design", async () => {
    const t = await testContext({ label: "ds-guidance", nested: true });
    try {
      await writeFile(join(t.root, "guidance.md"), DESIGN_MD, "utf8");
      expect(designSystemDoc(t.ctx.folder)?.path).toBe("guidance.md");
    } finally {
      await t.cleanup();
    }
  });

  test("no document ⇒ null, not an empty string", async () => {
    const t = await testContext({ label: "ds-none", nested: true });
    try {
      expect(designSystemDoc(t.ctx.folder)).toBeNull();
      expect(await readDesignSystemDoc(t.ctx.folder)).toBeNull();
    } finally {
      await t.cleanup();
    }
  });
});

describe("reading it", () => {
  test("reads through to the file, never a copy", async () => {
    const t = await testContext({ label: "ds-read", nested: true });
    try {
      const file = join(t.root, "..", "DESIGN.md");
      await writeFile(file, DESIGN_MD, "utf8");
      expect(await readDesignSystemDoc(t.ctx.folder)).toContain("Don't use two accents.");

      // The point of the whole design: edit the repo's file and the next read
      // has it, with no import, no re-scan and no daemon restart.
      await writeFile(file, DESIGN_MD.replace("two accents", "three accents"), "utf8");
      expect(await readDesignSystemDoc(t.ctx.folder)).toContain("three accents");
    } finally {
      await t.cleanup();
    }
  });

  test("a configured path that has gone missing reads as null, not a throw", async () => {
    const t = await testContext({
      label: "ds-missing",
      nested: true,
      config: designConfig({ designSystem: { path: "gone/DESIGN.md" } }),
    });
    try {
      expect(designSystemDoc(t.ctx.folder)?.path).toBe("../gone/DESIGN.md");
      expect(await readDesignSystemDoc(t.ctx.folder)).toBeNull();
    } finally {
      await t.cleanup();
    }
  });
});
