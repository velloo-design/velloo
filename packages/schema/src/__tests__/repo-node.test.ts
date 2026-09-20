import { describe, expect, test } from "bun:test";
import {
  isRepoNode,
  NodeSchema,
  parseRepoKey,
  repoImportIssue,
  repoKey,
  ScreenSchema,
} from "../index.ts";

describe("repository component nodes", () => {
  test("a $repo node round-trips with props and nested children", () => {
    const node = {
      $ref: "Tabs",
      $id: "tabs",
      $repo: { importPath: "@mantine/core", exportName: "Tabs" },
      props: { defaultValue: "overview" },
      children: [
        {
          $ref: "Tabs.List",
          $repo: { importPath: "@mantine/core", exportName: "Tabs", member: "List" },
          children: [
            {
              $ref: "Tabs.Tab",
              $repo: { importPath: "@mantine/core", exportName: "Tabs", member: "Tab" },
              props: { value: "overview", children: "Overview" },
            },
          ],
        },
      ],
    };
    const parsed = NodeSchema.parse(node);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(node);
    expect(isRepoNode(parsed)).toBe(true);
    expect(ScreenSchema.safeParse({ id: "s", name: "S", tree: node }).success).toBe(true);
  });

  test("default exports, local root-relative paths, apps and proxies are accepted", () => {
    const parsed = NodeSchema.safeParse({
      $ref: "StatCard",
      $repo: {
        importPath: "./src/components/stat-card",
        exportName: "default",
        app: "web",
        proxy: "stat-card-proxy",
      },
    });
    expect(parsed.success).toBe(true);
  });

  test.each([
    ['"; alert(1); "', "characters"],
    ["/etc/passwd", "absolute"],
    ["../../secrets", "climb"],
    ["./src/../../x", "climb"],
    ["pkg name", "characters"],
  ])("rejects malformed import %p", (importPath, fragment) => {
    expect(repoImportIssue(importPath)).toContain(fragment);
    const parsed = NodeSchema.safeParse({ $ref: "X", $repo: { importPath, exportName: "X" } });
    expect(parsed.success).toBe(false);
  });

  test("rejects export and member names that are not identifiers", () => {
    for (const $repo of [
      { importPath: "@mantine/core", exportName: "Tabs List" },
      { importPath: "@mantine/core", exportName: "Tabs", member: "List}" },
      { importPath: "@mantine/core", exportName: "Tabs", member: ".List" },
    ]) {
      expect(NodeSchema.safeParse({ $ref: "Tabs", $repo }).success).toBe(false);
    }
  });

  test("repoKey separates apps, modules and members", () => {
    const base = { importPath: "@mantine/core", exportName: "Tabs" };
    const keys = new Set([
      repoKey(base),
      repoKey({ ...base, member: "List" }),
      repoKey({ ...base, app: "admin" }),
      repoKey({ ...base, importPath: "@/components/tabs" }),
    ]);
    expect(keys.size).toBe(4);
    expect(repoKey(base)).toBe("repo::@mantine/core#Tabs");
  });

  test("parseRepoKey inverts repoKey and rejects anything malformed", () => {
    for (const ref of [
      { importPath: "@mantine/core", exportName: "Tabs" },
      { importPath: "@mantine/core", exportName: "Tabs", member: "List" },
      { importPath: "./src/components/card", exportName: "default", app: "web:admin" },
    ]) {
      expect(parseRepoKey(repoKey(ref))).toEqual(ref);
    }
    expect(parseRepoKey("repo::../../etc#X")).toBeNull();
    expect(parseRepoKey("Button")).toBeNull();
  });

  test("legacy $emitAs nodes still parse unchanged", () => {
    const node = {
      $ref: "Box",
      $emitAs: { name: "BillingTable", importPath: "@/components/billing-table" },
      children: [{ $ref: "Text", props: { children: "approximation" } }],
    };
    expect(JSON.parse(JSON.stringify(NodeSchema.parse(node)))).toEqual(node);
  });
});
