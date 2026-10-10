import { describe, expect, test } from "bun:test";
import { buildingBlocks, type RepoCatalog, type RepoCatalogEntry } from "../catalog.ts";

function entry(name: string, from: string, packageName?: string): RepoCatalogEntry {
  return {
    id: name,
    name,
    identity: { importPath: from, exportName: packageName ? name : "default" },
    key: `${from}#${name}`,
    source: packageName ? "package" : "local",
    ...(packageName ? { packageName } : {}),
    family: name.split(".")[0] ?? name,
    props: [],
    acceptsChildren: true,
    states: [],
    provenance: [],
    styleProps: [],
  };
}

function catalogOf(entries: RepoCatalogEntry[], appEntries: string[]): RepoCatalog {
  return {
    entries,
    byId: new Map(),
    byKey: new Map(),
    apps: [
      {
        hostRoot: "/app",
        recipes: [],
        preview: { kind: "none", label: "no preview entry" },
        wrappers: [],
        globalStyles: [],
        entries: appEntries,
        skipped: [],
      },
    ],
    warnings: [],
  };
}

describe("buildingBlocks", () => {
  const routerOnly = [
    entry("App", "./src/App"),
    entry("Target", "./src/pages/target"),
    entry("BrowserRouter", "react-router-dom", "react-router-dom"),
    entry("Routes", "react-router-dom", "react-router-dom"),
    entry("Route", "react-router-dom", "react-router-dom"),
  ];
  const appEntries = ["src/main.jsx", "src/App.jsx", "src/pages/target.jsx"];

  test("an app that renders only its pages through a router has nothing to build with", () => {
    expect(buildingBlocks(catalogOf(routerOnly, appEntries))).toEqual([]);
  });

  test("its own components and a library's are parts; the router's links are too", () => {
    const parts = [
      entry("StatCard", "./src/components/stat-card"),
      entry("Tabs.List", "@mantine/core", "@mantine/core"),
      entry("NavLink", "react-router-dom", "react-router-dom"),
    ];
    const found = buildingBlocks(catalogOf([...routerOnly, ...parts], appEntries));
    expect(found.map((item) => item.name)).toEqual(["StatCard", "Tabs.List", "NavLink"]);
  });
});
