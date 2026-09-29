import { afterEach, expect, test } from "bun:test";
import { createProvider as createHtmlProvider } from "@velloo/provider-html";
import { type TestContext, testContext } from "../../testing/design-folder.ts";
import { addScreen } from "../index.ts";

let f: TestContext | undefined;

afterEach(async () => {
  await f?.cleanup();
  f = undefined;
});

test("an empty screen is padded in the folder's own style channel", async () => {
  f = await testContext({ label: "add-screen-default" });
  const tailwind = await addScreen(f.ctx, { name: "Tailwind" });
  expect(tailwind.ok && tailwind.value.screen.tree).toMatchObject({ props: { className: "p-6" } });

  const html = createHtmlProvider();
  f.ctx.providers.default = html;
  f.ctx.defaultProvider = html;
  const inline = await addScreen(f.ctx, { name: "Inline" });
  expect(inline.ok && inline.value.screen.tree).toEqual({
    $ref: "Card",
    props: { style: { padding: "24px" } },
  });
});
