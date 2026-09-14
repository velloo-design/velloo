import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHROMIUM_FULL_INSTALL_ARGV,
  CHROMIUM_INSTALL_ARGV,
  PLAYWRIGHT_VERSION,
} from "../browser-install.ts";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `velloo browser install` shells out to a pinned `playwright` CLI, which
 * downloads exactly one Chromium revision; `playwright-core` then refuses to
 * launch any other. If the two versions drift, the install reports success and
 * every capture still fails with "browser missing" — so the only symptom is a
 * user who cannot make screenshots work no matter what they do.
 */
describe("the pinned playwright install", () => {
  const versionOf = (argv: readonly string[]): string | undefined =>
    argv.find((arg) => arg.startsWith("playwright@"))?.slice("playwright@".length);

  test("matches the version playwright-core actually resolves to on disk", () => {
    const manifest = Bun.resolveSync("playwright-core/package.json", here);
    const installed = JSON.parse(readFileSync(manifest, "utf8")).version;
    expect(PLAYWRIGHT_VERSION).toBe(installed);
  });

  test("matches the version this package declares", () => {
    const declared = JSON.parse(readFileSync(join(here, "..", "..", "package.json"), "utf8"));
    expect(PLAYWRIGHT_VERSION).toBe(declared.devDependencies["playwright-core"]);
    // The CLI and the runtime are separate packages that ship the same browser.
    expect(PLAYWRIGHT_VERSION).toBe(declared.devDependencies.playwright);
  });

  test("is the version both install commands pin", () => {
    expect(versionOf(CHROMIUM_INSTALL_ARGV)).toBe(PLAYWRIGHT_VERSION);
    expect(versionOf(CHROMIUM_FULL_INSTALL_ARGV)).toBe(PLAYWRIGHT_VERSION);
  });

  test("fetches only the headless shell by default", () => {
    // The headed capture session needs the full build; everything else is
    // headless, and the ~110MB shell beats a ~300MB Chrome for Testing.
    expect([...CHROMIUM_INSTALL_ARGV]).toContain("--only-shell");
    expect([...CHROMIUM_FULL_INSTALL_ARGV]).not.toContain("--only-shell");
  });
});
