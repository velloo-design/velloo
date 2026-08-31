import { describe, expect, test } from "bun:test";
import { featuresMeanPopup } from "../browser-session.ts";

/**
 * The tab-vs-popup discriminator behind single-tab enforcement. The feature
 * lists below are verbatim from Chrome's CDP `Page.windowOpen` for each case.
 */
describe("featuresMeanPopup", () => {
  test("a target=_blank link is a tab, so it folds into the capture tab", () => {
    // Chrome reports the full browser-UI feature set for an ordinary new tab —
    // including when the link carries rel="noopener".
    expect(
      featuresMeanPopup(["menubar", "toolbar", "status", "scrollbars", "resizable", "noopener"]),
    ).toBe(false);
  });

  test("a sized window.open is a popup, so it is left alone", () => {
    // The shape of a sign-in popup: sizing instead of browser chrome. Folding
    // one would sever the opener relationship the OAuth flow posts back through.
    expect(featuresMeanPopup(["width=500", "height=600", "resizable"])).toBe(true);
  });

  test("no features at all means a tab", () => {
    // Nothing observed to justify calling it a popup — and folding is the safe
    // default for a session that promises a single tab.
    expect(featuresMeanPopup([])).toBe(false);
  });

  test("either browser-chrome feature alone is enough to call it a tab", () => {
    expect(featuresMeanPopup(["toolbar"])).toBe(false);
    expect(featuresMeanPopup(["menubar"])).toBe(false);
  });
});
