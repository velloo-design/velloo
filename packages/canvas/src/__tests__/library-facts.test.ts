import { describe, expect, test } from "bun:test";
import type { FolderConfig } from "../api.ts";
import {
  hasMixedStyling,
  type LibraryEntry,
  orderedLibraries,
  providerName,
  showsId,
  showsVersion,
  sourceBadge,
  stylingText,
  versionText,
} from "../components/Settings/library-facts.ts";

const lib = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: "default",
  providerId: "shadcn-upstream",
  version: "2026.05.22",
  source: "in-repo",
  styleLabel: "Tailwind classes",
  ...over,
});

const cfg = (libraries: LibraryEntry[], over: Partial<FolderConfig> = {}) =>
  ({ libraries, defaultLibrary: "default", styling: null, ...over }) as FolderConfig;

describe("library facts", () => {
  test("names providers, falling back to an id it doesn't know", () => {
    expect(providerName("shadcn-upstream")).toBe("shadcn");
    expect(providerName("mui")).toBe("Material UI");
    expect(providerName("solid-ui")).toBe("solid-ui");
  });

  test("a dated version is a vendored snapshot; a semver one is a release", () => {
    expect(versionText("2026.05.22")).toBe("snapshot 2026.05.22");
    expect(versionText("6")).toBe("v6");
    expect(versionText("6.1.0")).toBe("v6.1.0");
  });

  test("a repo-backed library shows no version — the pin is only velloo's fallback", () => {
    expect(showsVersion(lib({ source: "in-repo" }))).toBe(false);
    expect(showsVersion(lib({ source: "binary" }))).toBe(true);
    const badge = sourceBadge("in-repo", "2026.05.22");
    expect(badge.text).toBe("your repo");
    // The fallback stays discoverable rather than passing itself off as
    // the version you're designing against.
    expect(badge.title).toContain("2026.05.22");
  });

  test("an unknown source still says what config says", () => {
    expect(sourceBadge("binary", "6").text).toBe("bundled");
    expect(sourceBadge("cache", "6").text).toBe("cached");
    expect(sourceBadge("registry", "6")).toEqual({ text: "registry" });
  });

  test("the default library leads the list", () => {
    const libs = [lib({ id: "marketing" }), lib({ id: "default" })];
    expect(orderedLibraries(cfg(libs)).map((l) => l.id)).toEqual(["default", "marketing"]);
  });

  test("an id shows when a screen would have to name it", () => {
    // Reached only by name.
    expect(showsId(lib({ id: "marketing", providerId: "mui" }), false)).toBe(true);
    expect(showsId(lib({ id: "mui", providerId: "mui" }), false)).toBe(true);
    // Reached by omitting `library`, and the line already says the rest.
    expect(showsId(lib({ id: "default" }), true)).toBe(false);
    expect(showsId(lib({ id: "shadcn", providerId: "shadcn-upstream" }), true)).toBe(false);
    expect(showsId(lib({ id: "marketing" }), true)).toBe(true);
  });

  test("styling reports the default library's channel, not the CSS axis", () => {
    // A MUI folder writes no `config.styling` at all — the old fact called
    // that Tailwind.
    const mui = lib({ providerId: "mui", styleLabel: "sx props", source: "binary" });
    expect(stylingText(cfg([mui]))).toBe("sx props");
    expect(stylingText(cfg([lib()]))).toBe("Tailwind classes");
    expect(stylingText(cfg([lib({ styleLabel: "Inline styles" })]))).toBe("Inline styles");
  });

  test("styling falls back to the CSS axis when the daemon sends no channel", () => {
    expect(stylingText(cfg([lib({ styleLabel: null })], { styling: "none" }))).toBe(
      "Inline styles",
    );
    expect(stylingText(cfg([lib({ styleLabel: null })]))).toBe("Tailwind classes");
  });

  test("mixed channels are only claimed when the libraries actually disagree", () => {
    expect(hasMixedStyling([lib(), lib({ id: "b" })])).toBe(false);
    expect(hasMixedStyling([lib(), lib({ id: "b", styleLabel: "sx props" })])).toBe(true);
  });
});
