import { afterEach, describe, expect, test } from "bun:test";
import { addScreenShape, updateScreenShape } from "@velloo/protocol";
import { z } from "zod";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import { addScreen, updateScreen } from "../index.ts";

/**
 * A screen's `route` is the app path it stands for. It reaches the canvas
 * mount's router contexts, so it has to survive the write and come back off
 * disk — an in-memory-only route would light the right nav item until the
 * first reload.
 */

let f: TestContext | undefined;

afterEach(async () => {
  await f?.cleanup();
  f = undefined;
});

async function context(): Promise<TestContext> {
  f = await testContext({ label: "screen-route" });
  return f;
}

describe("screen route", () => {
  test("add_screen persists the route", async () => {
    const { ctx, reload } = await context();
    const created = await addScreen(ctx, { name: "Account", route: "/settings/account" });
    expect(created.ok).toBe(true);

    const folder = await reload();
    expect(folder.screens.get("account")?.route).toBe("/settings/account");
  });

  test("update_screen sets a route and null clears it", async () => {
    const { ctx, reload } = await context();
    await addScreen(ctx, { name: "Account" });

    const set = await updateScreen(ctx, { screenId: "account", patch: { route: "/account" } });
    expect(set.ok).toBe(true);
    expect((await reload()).screens.get("account")?.route).toBe("/account");

    const cleared = await updateScreen(ctx, { screenId: "account", patch: { route: null } });
    expect(cleared.ok).toBe(true);
    expect((await reload()).screens.get("account")?.route).toBeUndefined();
  });

  test("a rename leaves the route alone", async () => {
    const { ctx, reload } = await context();
    await addScreen(ctx, { name: "Account", route: "/account" });

    await updateScreen(ctx, { screenId: "account", patch: { name: "Profile" } });
    const screen = (await reload()).screens.get("account");
    expect(screen?.name).toBe("Profile");
    expect(screen?.route).toBe("/account");
  });

  test("a route written without its leading slash is taken as one", () => {
    const add = z.strictObject(addScreenShape).parse({ name: "Account", route: "settings" });
    expect(add.route).toBe("/settings");

    const update = z
      .strictObject(updateScreenShape)
      .parse({ screenId: "account", patch: { route: " settings/account " } });
    expect(update.patch.route).toBe("/settings/account");
  });
});
