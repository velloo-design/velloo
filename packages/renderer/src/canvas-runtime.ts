/**
 * Inlined into a design doc only when the screen's adapter has an available
 * canvas bundle (#18). Imports the per-folder `mountScreen` module (the host
 * app's actually-installed components, bundled by the server) and client-mounts
 * the screen against the EXACT installed version, over the in-process SSR.
 *
 * Fail-safe by construction: the SSR content renders first inside
 * `#velloo-ssr`. The mount only hides it once a component commits (the bundle's
 * `onReady`); any failure — bundle import error, build error, a component that
 * throws (the bundle's ErrorBoundary `onError`) — restores the SSR. So a broken
 * installed-component mount is never worse than today's render.
 *
 * Selection still works: the resolved tree bakes each node's `data-node-path`,
 * which the bundle's interpreter forwards to the mounted DOM, so IFRAME_RUNTIME
 * resolves clicks the same way it does for SSR'd nodes.
 *
 * Raw JS string — `__VELLOO_CANVAS_BUNDLE_URL__` is replaced with a JSON string
 * literal at document-build time.
 */
export const CANVAS_RUNTIME = `
(() => {
  if (window.__velloo_canvas) return;
  window.__velloo_canvas = {};
  var dataEl = document.getElementById("velloo-canvas-data");
  if (!dataEl) return;
  var payload;
  try { payload = JSON.parse(dataEl.textContent || "{}"); } catch (e) { return; }
  if (!payload || !payload.tree) return;
  var BUNDLE_URL = __VELLOO_CANVAS_BUNDLE_URL__;
  var ssr = document.getElementById("velloo-ssr");
  var root = document.createElement("div");
  root.id = "velloo-canvas-root";

  function settleOnSsr() {
    if (root.parentNode) root.parentNode.removeChild(root);
    if (ssr) ssr.style.display = "";
    window.__velloo_canvas_ready = true;
  }
  function settleOnMount() {
    if (ssr) ssr.style.display = "none";
    window.__velloo_canvas_ready = true;
  }

  import(BUNDLE_URL).then(function (mod) {
    if (!mod || typeof mod.mountScreen !== "function" || mod.__velloo_canvas_error) {
      settleOnSsr();
      return;
    }
    document.body.appendChild(root);
    try {
      mod.mountScreen({
        tree: payload.tree,
        themeOptions: payload.themeOptions,
        el: root,
        onReady: settleOnMount,
        onError: settleOnSsr,
      });
    } catch (e) {
      settleOnSsr();
    }
  }).catch(function () { settleOnSsr(); });
})();
`;
