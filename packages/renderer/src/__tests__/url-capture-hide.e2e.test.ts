import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { pngSize } from "../screenshot-diff.ts";
import { captureUrlScreenshot, HideSelectorError } from "../url-capture.ts";

/**
 * A page wearing what a design leaves out: a consent bar that pushes the
 * content down and locks nothing, and a chat launcher that mounts a moment
 * after load. Hiding them has to hold for the one that arrives late, has to
 * survive a `style-src` policy that would refuse an injected `<style>`, and has
 * to take them out of the walked DOM as well as out of the picture.
 *
 * Opt-in (needs `velloo browser install`): `VELLOO_E2E=1 bun test`.
 */
const RUN = process.env.VELLOO_E2E === "1";

const PAGE = `<!doctype html><html><body style="margin:0">
<div id="consent" style="height:120px;background:#222;color:#fff">We value your privacy</div>
<main style="height:400px">Trail guide</main>
<script>
  setTimeout(() => {
    const chat = document.createElement("div");
    chat.className = "chat-launcher";
    chat.textContent = "Chat with us";
    chat.style.cssText = "position:fixed;right:0;bottom:0;width:80px;height:80px;background:#06f";
    document.body.append(chat);
  }, 300);
</script>
</body></html>`;

let server: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: (req) =>
      new Response(PAGE, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          ...(new URL(req.url).pathname === "/strict"
            ? { "content-security-policy": "style-src 'self'" }
            : {}),
        },
      }),
  });
});
afterAll(() => server?.stop(true));

describe.skipIf(!RUN)("URL capture hide (Playwright)", () => {
  const viewport = { w: 400, h: 300 };
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`;
  const hide = ["#consent", ".chat-launcher", ".never-there"];

  test("a page captured as served has the banner and the launcher in it", async () => {
    const r = await captureUrlScreenshot({ url: url("/"), viewport, dom: true });
    const dom = JSON.stringify(r.dom);
    expect(dom).toContain("We value your privacy");
    expect(dom).toContain("Chat with us");
    expect(pngSize(r.png).height).toBe(520);
    expect(r.hidden).toBeUndefined();
  }, 30_000);

  test("hidden selectors leave the picture and the DOM, including one that mounts late", async () => {
    const r = await captureUrlScreenshot({ url: url("/"), viewport, dom: true, hide });
    const dom = JSON.stringify(r.dom);
    expect(dom).not.toContain("We value your privacy");
    expect(dom).not.toContain("Chat with us");
    expect(dom).toContain("Trail guide");
    // The bar's 120px is gone from the layout, not painted over.
    expect(pngSize(r.png).height).toBe(400);
    expect(r.hidden).toEqual({ "#consent": 1, ".chat-launcher": 1, ".never-there": 0 });
  }, 30_000);

  test("a style-src policy does not stop it", async () => {
    // The policy also drops the page's own inline styles, so the picture's
    // size says nothing here; the walked DOM does.
    const r = await captureUrlScreenshot({ url: url("/strict"), viewport, dom: true, hide });
    const dom = JSON.stringify(r.dom);
    expect(dom).toContain("Trail guide");
    expect(dom).not.toContain("We value your privacy");
    expect(dom).not.toContain("Chat with us");
  }, 30_000);

  test("a selector that is not CSS is refused by name", async () => {
    const capture = captureUrlScreenshot({
      url: url("/"),
      viewport,
      hide: ["#consent", "div[", "{}"],
    });
    await expect(capture).rejects.toBeInstanceOf(HideSelectorError);
    await expect(capture).rejects.toThrow('"div[", "{}"');
  }, 30_000);
});
