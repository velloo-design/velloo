import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "@velloo/schema";
import { repoKey } from "@velloo/schema";
import { CanvasBundler } from "../../live/canvas-bundler.ts";
import { RepoComponents } from "../catalog.ts";
import { fixtureApp } from "./fixture-app.ts";

/**
 * A monorepo design folder drawing on two apps: each app's components keep
 * their own identity (`app`), a name both apps export is qualified per app,
 * each app gets its own preview entry, and a component resolves against the
 * app that owns it.
 */
let web: Awaited<ReturnType<typeof fixtureApp>>;
let admin: Awaited<ReturnType<typeof fixtureApp>>;
let repo: RepoComponents;

beforeAll(async () => {
  web = await fixtureApp();
  admin = await fixtureApp();
  // The admin app's StatCard renders differently, so resolving it against the
  // wrong app would show.
  await writeFile(
    join(admin.root, "src/components/stat-card.tsx"),
    'export function StatCard({ label }: { label: string }) {\n  return <aside data-admin="yes">{label}</aside>;\n}\n',
  );
  await writeFile(
    join(web.folder, "preview.admin.jsx"),
    "export default function AdminPreview({ children }) {\n  return <div data-admin-preview>{children}</div>;\n}\n",
  );
  repo = new RepoComponents({
    folderRoot: web.folder,
    config: () =>
      ({
        hostApp: { root: web.root },
        hostApps: { admin: { root: admin.root } },
      }) as unknown as Config,
    reservedIds: () => new Set(),
  });
});
afterAll(async () => {
  await web.cleanup();
  await admin.cleanup();
});

describe("repository components across host apps", () => {
  test("each app's components carry their app, and shared names are qualified per app", async () => {
    const catalog = await repo.catalog();
    expect(catalog.apps.map((app) => app.app ?? "(default)")).toEqual(["(default)", "admin"]);
    expect(catalog.byId.has("StatCard")).toBe(false);
    expect(catalog.byId.get("App.StatCard")?.identity).toEqual({
      importPath: "./src/components",
      exportName: "StatCard",
    });
    expect(catalog.byId.get("AdminApp.StatCard")?.identity).toEqual({
      importPath: "./src/components",
      exportName: "StatCard",
      app: "admin",
    });
    expect(catalog.byId.get("AdminApp.StatCard")?.qualifiedBecause).toContain(
      "more than one source",
    );
  });

  test("each app gets its own preview entry", () => {
    expect(repo.preview(undefined)).toMatchObject({ kind: "file", label: "preview.jsx" });
    expect(repo.preview("admin")).toMatchObject({ kind: "file", label: "preview.admin.jsx" });
  });

  test("a component resolves against the app that owns it", async () => {
    const bundler = new CanvasBundler(
      web.folder,
      () => ({ root: web.root }),
      () => undefined,
      false,
      {
        repo,
      },
    );
    const adminKey = repoKey({
      importPath: "./src/components",
      exportName: "StatCard",
      app: "admin",
    });
    const webKey = repoKey({ importPath: "./src/components", exportName: "Badge" });
    const result = await bundler.build("default", [adminKey, webKey]);
    expect(result.usable).toBe(true);
    const admins = result.diagnostics.find((d) => d.id === adminKey);
    expect(admins).toMatchObject({ status: "exact", app: "admin", preview: "preview.admin.jsx" });
    expect(result.code).toContain('data-admin": "yes"');
    // Both apps link the same React, so the default app's component shares the mount.
    expect(result.diagnostics.find((d) => d.id === webKey)?.status).toBe("exact");
    expect(result.code).toContain("data-admin-preview");
  }, 60_000);
});
