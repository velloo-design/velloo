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
  window.__velloo_canvas_bundle = BUNDLE_URL;
  var ssr = document.getElementById("velloo-ssr");
  var root = document.createElement("div");
  root.id = "velloo-canvas-root";

  function settleOnSsr() {
    if (root.parentNode) root.parentNode.removeChild(root);
    if (ssr) ssr.style.display = "";
    window.__velloo_canvas_ready = true;
  }
  // The SSR tree stays in the document as a visual fallback, but it must stop
  // answering to node identity the moment the mount owns the screen. Every
  // consumer resolves a path to the FIRST match — the iframe runtime's rects,
  // computed styles and forced states, and the capture path's clip locator and
  // rect sweep — and a display:none copy measures 0x0. Stripping here fixes all
  // of them at once; filtering at each call site only fixes the ones that
  // remembered to, and the capture path (a Playwright selector, not our code)
  // could not be fixed that way at all.
  var IDENTITY_ATTRS = ["data-node-path", "data-snippet-id", "data-snippet-path"];

  function dropIdentity(el) {
    var stale = el.querySelectorAll("[" + IDENTITY_ATTRS.join("],[") + "]");
    for (var i = 0; i < stale.length; i++) {
      for (var j = 0; j < IDENTITY_ATTRS.length; j++) stale[i].removeAttribute(IDENTITY_ATTRS[j]);
    }
    for (var k = 0; k < IDENTITY_ATTRS.length; k++) el.removeAttribute(IDENTITY_ATTRS[k]);
  }

  function settleOnMount() {
    if (ssr) {
      ssr.style.display = "none";
      dropIdentity(ssr);
    }
    window.__velloo_canvas_ready = true;
  }

  var diagnostics = [];
  function report(entry) {
    // Runtime findings (a repository component that threw, or rendered without
    // its stylesheet) replace the build-time verdict for that component, then
    // reach the daemon so MCP status and screenshots can report them too.
    for (var i = 0; i < diagnostics.length; i++) {
      if (diagnostics[i].id === entry.id) { diagnostics[i] = Object.assign({}, diagnostics[i], entry); entry = null; break; }
    }
    if (entry) diagnostics.push(entry);
    window.__velloo_canvas_diagnostics = diagnostics;
    refreshBadge();
    try {
      var body = JSON.stringify({ bundle: BUNDLE_URL, diagnostics: diagnostics });
      var url = new URL("/api/canvas/runtime-diagnostics", document.baseURI).href;
      if (navigator.sendBeacon) navigator.sendBeacon(url, body);
    } catch (e) {}
  }

  function exposeDiagnostics(items) {
    diagnostics = Array.isArray(items) ? items.slice() : [];
    window.__velloo_canvas_diagnostics = diagnostics;
    refreshBadge();
  }

  var badge = null;
  function refreshBadge() {
    var counts = { adapted: 0, fallback: 0, proxy: 0, unavailable: 0 };
    var issues = 0;
    diagnostics.forEach(function (item) {
      if (Object.prototype.hasOwnProperty.call(counts, item.status)) counts[item.status] += 1;
      if (item.code) issues += 1;
    });
    var degraded = Object.keys(counts).filter(function (key) { return counts[key] > 0; });
    document.documentElement.dataset.vellooCanvasFidelity = degraded.length ? degraded.join(",") : "exact";
    if ((!degraded.length && !issues) || new URLSearchParams(location.search).get("canvas") !== "1") return;
    if (!badge) {
      badge = document.createElement("div");
      badge.setAttribute("aria-label", "Canvas component fidelity");
      badge.style.cssText = "position:fixed;right:8px;bottom:8px;z-index:2147483647;pointer-events:none;padding:5px 8px;border:1px solid rgba(120,90,20,.45);border-radius:999px;background:rgba(255,248,220,.94);color:#4a3700;font:600 10px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;box-shadow:0 2px 8px rgba(0,0,0,.12)";
      document.body.appendChild(badge);
    }
    badge.setAttribute("data-velloo-canvas-status", degraded.join(","));
    var parts = degraded.map(function (key) { return counts[key] + " " + key; });
    if (issues) parts.push(issues + " diagnostic" + (issues === 1 ? "" : "s"));
    badge.textContent = "Canvas: " + parts.join(" · ");
    badge.title = diagnostics.filter(function (item) { return item.status !== "exact" || item.code; }).map(function (item) {
      return (item.name || item.id) + ": " + item.status + (item.code ? " [" + item.code + "]" : "") + (item.note ? " — " + item.note : "");
    }).join("\\n");
  }

  import(BUNDLE_URL).then(function (mod) {
    // The stub served on a build failure still exports a no-op mountScreen, so
    // checking the export alone is not enough: calling it would settle neither
    // onReady nor onError and __velloo_canvas_ready would never flip.
    if (!mod || typeof mod.mountScreen !== "function" || mod.__velloo_canvas_build_errors) {
      settleOnSsr();
      return;
    }
    exposeDiagnostics(mod.__velloo_canvas_diagnostics);
    document.body.appendChild(root);
    try {
      mod.mountScreen({
        tree: payload.tree,
        themeOptions: payload.themeOptions,
        preview: payload.preview,
        pathname: payload.pathname,
        onDiagnostic: report,
        el: root,
        onReady: settleOnMount,
        onError: settleOnSsr,
      });
    } catch (e) {
      settleOnSsr();
    }
  }).catch(function (error) {
    // A module that throws while loading (one reading location.host under a
    // capture's opaque origin) rejects the whole import; say so per component
    // rather than leaving the server render unexplained.
    var refs = [];
    try { refs = (new URL(BUNDLE_URL, document.baseURI).searchParams.get("refs") || "").split(","); } catch (e) {}
    var note = "A module threw while the bundle loaded: " + String(error && error.message || error).slice(0, 300);
    refs.forEach(function (id) {
      if (id.indexOf("repo:") === 0) report({ id: id, status: "unavailable", code: "render-threw", note: note });
    });
    settleOnSsr();
  });
})();
`;
