import { afterEach, describe, expect, test } from "bun:test";
import type { ComponentNode } from "@velloo/schema";
import { Hono } from "hono";
import { designScreen, type TestContext, testContext } from "../../testing/design-folder.ts";
import { createMutateRouter } from "../mutate.ts";

/**
 * The Library's "Add to screen" posts `add_node` with a repository identity —
 * the only canvas caller of the op, and the reason it has an HTTP route.
 */

let harness: TestContext | null = null;

afterEach(async () => {
  await harness?.cleanup();
  harness = null;
});

async function app(): Promise<{ server: Hono; h: TestContext }> {
  const h = await testContext({
    label: "mutate-add-node",
    screens: { home: designScreen("home", { tree: { $ref: "Box", children: [] } }) },
  });
  harness = h;
  const server = new Hono();
  server.route(
    "/api/mutate",
    createMutateRouter(() => h.ctx),
  );
  return { server, h };
}

const post = (server: Hono, body: unknown) =>
  server.request("/api/mutate/add_node", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("add_node route", () => {
  test("places a repository component by identity", async () => {
    const { server, h } = await app();
    const res = await post(server, {
      screenId: "home",
      parentPath: [],
      componentRef: "Button",
      repo: { importPath: "@mantine/core", exportName: "Button" },
      props: { variant: "filled" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { path: number[] }).path).toEqual([0]);

    const tree = h.ctx.folder.screens.get("home")?.tree as ComponentNode;
    expect(tree.children?.[0]).toMatchObject({
      $ref: "Button",
      $repo: { importPath: "@mantine/core", exportName: "Button" },
      props: { variant: "filled" },
    });
  });

  test("rejects scalar children the way the MCP tool does", async () => {
    const { server } = await app();
    const res = await post(server, {
      screenId: "home",
      parentPath: [],
      componentRef: "Box",
      children: "hello",
    });
    expect(res.status).toBe(400);
  });
});
