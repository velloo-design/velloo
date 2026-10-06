import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { captureMountedDocument, captureScreenshot } from "../index.ts";

setDefaultTimeout(60_000);

// Opt-in: requires `velloo browser install`.
const RUN = process.env.VELLOO_E2E === "1";

/**
 * One page load, a picture and the page as markup.
 *
 * Publish takes both from the same load so the app's components mount once.
 * That is only a saving if neither capture knows the other happened: the
 * markup has to be what a load taken for the markup alone gives, and the
 * picture what a load taken for the picture alone gives.
 */
const html = `<!doctype html>
<html lang="en">
  <head>
    <base href="about:blank">
    <style>body { margin: 0; font: 16px sans-serif } .card { padding: 24px; background: #fde68a }</style>
    <style id="by-cssom"></style>
  </head>
  <body data-app="on">
    <div id="velloo-ssr">server render</div>
    <script type="application/json" id="velloo-canvas-data">{}</script>
    <div id="velloo-canvas-root">
      <section class="card" data-node-path="0">
        <input autofocus value="typed" data-node-path="0.0" />
        <textarea data-node-path="0.1"></textarea>
        <input type="checkbox" data-node-path="0.2" />
        <p class="late" data-node-path="0.3">Deployed <b>now</b></p>
      </section>
    </div>
    <script>
      document.getElementById("velloo-ssr").style.display = "none";
      document.getElementById("by-cssom").sheet.insertRule(".late { color: rgb(0, 128, 0) }");
      document.querySelector("textarea").value = "written";
      document.querySelector("input[type=checkbox]").checked = true;
      document.documentElement.setAttribute("data-scheme", "light");
      window.__velloo_canvas_ready = true;
    </script>
  </body>
</html>`;
const viewport = { w: 600, h: 300 };

describe.skipIf(!RUN)("captureScreenshot({ freeze }) (Playwright)", () => {
  test("the markup is the markup a load of its own would give", async () => {
    const alone = await captureMountedDocument({ html, viewport });
    const together = (await captureScreenshot({ html, viewport, freeze: true })).frozen;
    expect(together).toBeDefined();
    expect(together?.body).toBe(alone.body);
    expect(together?.head).toEqual(alone.head);
    expect(together?.htmlAttributes).toEqual(alone.htmlAttributes);
    expect(together?.bodyAttributes).toEqual(alone.bodyAttributes);
    expect(together?.html).toBe(alone.html);
    expect(together?.mounted).toBe(true);
  });

  test("the picture is the picture a load of its own would give", async () => {
    const alone = await captureScreenshot({ html, viewport });
    const together = await captureScreenshot({ html, viewport, freeze: true });
    expect(alone.frozen).toBeUndefined();
    expect(together.png.equals(alone.png)).toBe(true);
  });

  test("what is frozen is the page's state, with nothing that runs and no trace of the camera", async () => {
    const { frozen } = await captureScreenshot({ html, viewport, freeze: true });
    const body = frozen?.body ?? "";
    // Properties become attributes: markup is all a share has.
    expect(body).toMatch(/<input[^>]*value="typed"/);
    expect(body).toContain(">written</textarea>");
    expect(body).toMatch(/<input[^>]*type="checkbox"[^>]*checked/);
    // The hidden server render and every script are gone; the paths are not.
    expect(body).not.toContain("server render");
    expect(body).not.toContain("<script");
    expect(body).toContain('data-node-path="0.3"');
    // A screenshot hides the caret through an inline style; none of it is kept.
    expect(body).not.toMatch(/style=""/);
    // Rules written through the CSSOM are spelled out.
    const css = (frozen?.head ?? []).map((style) => style.css ?? "").join("\n");
    expect(css).toContain(".card");
    expect(css).toMatch(/\.late\s*\{\s*color:\s*rgb\(0, 128, 0\)/);
    expect(frozen?.htmlAttributes["data-scheme"]).toBe("light");
    expect(frozen?.bodyAttributes["data-app"]).toBe("on");
    expect(frozen?.html).not.toContain("<base");
  });

  test("a page whose mount has not taken says so itself", async () => {
    const unmounted = html.replace('.style.display = "none"', '.style.display = "block"');
    const { frozen } = await captureScreenshot({ html: unmounted, viewport, freeze: true });
    expect(frozen?.mounted).toBe(false);
    expect(frozen?.body).toContain("server render");
  });
});
