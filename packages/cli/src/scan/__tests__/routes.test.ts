import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanAppRoutes } from "../routes.ts";

let appRoot: string;

async function write(rel: string, content = "export default function R() { return null; }") {
  const abs = join(appRoot, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
}

beforeEach(async () => {
  appRoot = join(tmpdir(), `velloo-tsr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(appRoot, { recursive: true });
  await writeFile(
    join(appRoot, "package.json"),
    JSON.stringify({ dependencies: { "@tanstack/react-router": "^1.0.0", vite: "^7.0.0" } }),
    "utf8",
  );
});

afterEach(async () => {
  await rm(appRoot, { recursive: true, force: true });
});

describe("scanAppRoutes — TanStack Router", () => {
  test("strips layouts/groups/pathless segments, collapses index, maps $param + .lazy", async () => {
    await write("src/routes/__root.tsx"); // root layout → skip
    await write("src/routes/index.tsx"); // → "/"
    await write("src/routes/(auth)/sign-in.tsx"); // group drops → "/sign-in"
    await write("src/routes/_authenticated/route.tsx"); // layout → skip
    await write("src/routes/_authenticated/dashboard.tsx"); // pathless drops → "/dashboard"
    await write("src/routes/_authenticated/dashboard.lazy.tsx"); // .lazy sibling → dedupes
    await write("src/routes/_authenticated/settings/route.tsx"); // layout → skip
    await write("src/routes/_authenticated/settings/account.tsx"); // → "/settings/account"
    await write("src/routes/posts.$postId.tsx"); // flat + dynamic → "/posts/[postId]"
    await write("src/routes/-components/widget.tsx"); // excluded → skip
    await write("src/routes/routeTree.gen.ts"); // generated → skip

    const result = await scanAppRoutes(appRoot);
    expect(result.framework).toBe("tanstack-router");

    const paths = result.routes.map((r) => r.routePath).sort();
    expect(paths).toEqual(["/", "/dashboard", "/posts/[postId]", "/settings/account", "/sign-in"]);
    // No layout / group / pathless noise leaked into the URLs.
    expect(paths.some((p) => /route|\(|_/.test(p))).toBe(false);

    const ids = result.routes.map((r) => r.id);
    expect(ids).toContain("posts-postid");
    expect(ids).toContain("settings-account");
  });

  test("honors tsr.config.json routesDirectory", async () => {
    await writeFile(
      join(appRoot, "tsr.config.json"),
      JSON.stringify({ routesDirectory: "app/pages" }),
      "utf8",
    );
    await write("app/pages/index.tsx");
    await write("app/pages/about.tsx");

    const result = await scanAppRoutes(appRoot);
    expect(result.framework).toBe("tanstack-router");
    expect(result.routes.map((r) => r.routePath).sort()).toEqual(["/", "/about"]);
  });
});

describe("scanAppRoutes — SvelteKit", () => {
  test("+page.svelte dirs are routes; groups drop, layouts/errors are not pages", async () => {
    await writeFile(
      join(appRoot, "package.json"),
      JSON.stringify({ devDependencies: { "@sveltejs/kit": "^2.0.0", vite: "^7.0.0" } }),
      "utf8",
    );
    await write("src/routes/+page.svelte"); // → "/"
    await write("src/routes/+layout.svelte"); // layout → skip
    await write("src/routes/+error.svelte"); // error page → skip
    await write("src/routes/about/+page.svelte"); // → "/about"
    await write("src/routes/about/+page.server.ts"); // load sibling → skip
    await write("src/routes/(marketing)/pricing/+page.svelte"); // group drops → "/pricing"
    await write("src/routes/blog/[slug]/+page.svelte"); // → "/blog/[slug]"

    const result = await scanAppRoutes(appRoot);
    expect(result.framework).toBe("sveltekit");
    expect(result.routes.map((r) => r.routePath).sort()).toEqual([
      "/",
      "/about",
      "/blog/[slug]",
      "/pricing",
    ]);
    expect(result.routes.map((r) => r.id)).toContain("blog-slug");
  });
});

describe("scanAppRoutes — Nuxt", () => {
  test("pages/*.vue map to routes with bracket params", async () => {
    await writeFile(
      join(appRoot, "package.json"),
      JSON.stringify({ dependencies: { nuxt: "^3.13.0" } }),
      "utf8",
    );
    await write("pages/index.vue", "<template><div /></template>");
    await write("pages/about.vue", "<template><div /></template>");
    await write("pages/users/[id].vue", "<template><div /></template>");

    const result = await scanAppRoutes(appRoot);
    expect(result.framework).toBe("nuxt");
    expect(result.routes.map((r) => r.routePath).sort()).toEqual(["/", "/about", "/users/[id]"]);
  });
});
