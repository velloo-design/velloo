import { describe, expect, test } from "bun:test";
import type { ComponentDescriptor } from "@velloo/provider";
import type { Node } from "@velloo/schema";
import { type LibraryEntry, nodeIcon } from "../tree-icons.ts";

/**
 * The row glyph carries two unrelated things, and the split is what the tests
 * are for: provenance is load-bearing (a colour the row's text can't say), the
 * kind glyph is navigational (find the image in a screen of `Box`es). Getting
 * that backwards — a helper stealing the primary-coloured component mark, or a
 * real library component reduced to "it's a button" — is the failure that
 * matters, and it looks fine in a screenshot.
 */

const entry = (over: Partial<LibraryEntry> & { id: string }): LibraryEntry =>
  ({ category: "ui", source: "velloo", ...over }) as ComponentDescriptor as LibraryEntry;

const library = new Map<string, LibraryEntry>([
  ["Box", entry({ id: "Box" })],
  ["Text", entry({ id: "Text" })],
  ["Image", entry({ id: "Image" })],
  ["Button", entry({ id: "Button", source: "shadcn" })],
  ["PricingCard", entry({ id: "PricingCard", source: "host", kind: "extension" })],
]);

const icon = (node: Node) => nodeIcon(node, library);

describe("nodeIcon", () => {
  test("marks the project's own components, extensions and dangling refs", () => {
    expect(icon({ $ref: "Button" })).toMatchObject({ tone: "text-primary" });
    expect(icon({ $ref: "Button" }).title).toContain("shadcn component");
    expect(icon({ $ref: "PricingCard" })).toMatchObject({ tone: "text-primary" });
    expect(icon({ $ref: "PricingCard" }).title).toContain("add_extension");
    expect(icon({ $ref: "Ghost" })).toMatchObject({ tone: "text-destructive" });

    // Three different shapes, so the distinction survives at 13px.
    const marks = ["Button", "PricingCard", "Ghost"].map((id) => icon({ $ref: id }).Icon);
    expect(new Set(marks).size).toBe(3);
  });

  test("a repo node is read from $repo, not from a manifest entry it collides with", () => {
    // `Button` is also a shadcn entry in the library above, and that entry is
    // not this node: a repo node's `$ref` is only its JSX name.
    const repo = icon({
      $ref: "Button",
      $repo: { importPath: "@mantine/core", exportName: "Button" },
    });
    expect(repo.tone).toBe("text-primary");
    expect(repo.title).toContain("@mantine/core");
    expect(repo.Icon).not.toBe(icon({ $ref: "Button" }).Icon);
  });

  test("velloo's own helpers get a kind glyph, never the component mark", () => {
    const text = icon({ $ref: "Text" });
    const image = icon({ $ref: "Image" });
    expect(text.tone).toBe("text-muted-foreground");
    expect(text.title).toBeUndefined();
    expect(text.Icon).not.toBe(image.Icon);
    expect(text.Icon).not.toBe(icon({ $ref: "Button" }).Icon);
  });

  test("a Box is read through its tag, because that is all that distinguishes one", () => {
    const div = icon({ $ref: "Box" });
    expect(icon({ $ref: "Box", props: { as: "div" } }).Icon).toBe(div.Icon);
    expect(icon({ $ref: "Box", props: { as: "ul" } }).Icon).not.toBe(div.Icon);
    expect(icon({ $ref: "Box", props: { as: "a" } }).Icon).not.toBe(div.Icon);
    // An unknown tag still reads as a plain container rather than nothing.
    expect(icon({ $ref: "Box", props: { as: "marquee" } }).Icon).toBe(div.Icon);
    expect(icon({ $ref: "Box", props: { as: 3 } }).Icon).toBe(div.Icon);
  });

  /**
   * The manifest is a separate fetch from the screens, so on a reload the
   * tree paints first. Reading that gap as "nothing resolves" put a red
   * warning on every row of the pane for the length of the round trip.
   */
  test("a manifest that hasn't arrived yet is not a screen full of dangling refs", () => {
    const loading = nodeIcon({ $ref: "Button" }, null);
    expect(loading.tone).toBe("text-muted-foreground");
    expect(loading.Icon).not.toBe(icon({ $ref: "Ghost" }).Icon);
    // The kind glyph still reads while provenance waits for the manifest.
    expect(nodeIcon({ $ref: "Box", props: { as: "ul" } }, null).Icon).toBe(
      icon({ $ref: "Box", props: { as: "ul" } }).Icon,
    );
  });

  test("snippet instances and param refs are their own kinds", () => {
    const snippet = icon({ $snippet: "hero", args: {} });
    expect(snippet.tone).toBe("text-violet-500");
    expect(snippet.title).toContain("@hero");
    expect(icon({ $param: "title" }).Icon).not.toBe(snippet.Icon);
  });
});
