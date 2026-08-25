/**
 * Inlined into a rendered design doc only when the screen has live-island
 * nodes. Mounts the real host components (bundled by the server, loaded
 * from `__VELLOO_LIVE_BUNDLE_URL__`) into the SSR markers `LiveIslandMarker`
 * emitted. Coexists with IFRAME_RUNTIME via a separate `window.__velloo_live`
 * guard.
 *
 * Visual-only (v1): the mount overlay keeps `pointer-events: none`, so the
 * selection overlay in IFRAME_RUNTIME stays authoritative — clicks resolve
 * to the marker's `data-node-path`, not the chart's internals. The SSR
 * placeholder skeleton stays visible until a component commits and is
 * restored if it throws, so a failed island is "no worse than today".
 *
 * Height reservation for `fit:"content"` markers: the real component mounts
 * into an `absolute; inset:0` overlay (out of flow), so it can't drive the
 * marker's height — left alone, a `fit:"content"` marker would only reserve
 * the hidden skeleton's height and the chart would overflow its card (lower
 * grid rows under-reserve deterministically). After each island settles we
 * measure the rendered content and pin `minHeight` on the marker, BEFORE
 * `markReady()` flips, so the screenshot's rect measurement reads the true
 * height. `aspect-video` markers are left untouched — they intentionally
 * lock 16:9.
 *
 * `window.__velloo_live_ready` flips true once every island has mounted or
 * fallen back (with a hard timeout cap), chart animation is frozen, AND
 * every marker's height is stable across consecutive frames — so the
 * screenshot path can wait for a deterministic, fully-reflowed final frame
 * (a multi-island grid no longer races the ready flag against a late
 * reflow).
 *
 * Raw JS string — `__VELLOO_LIVE_BUNDLE_URL__` is replaced with a JSON
 * string literal at document-build time.
 */
export const LIVE_RUNTIME = `
(() => {
  if (window.__velloo_live) return;
  window.__velloo_live = { ready: false };
  const BUNDLE_URL = __VELLOO_LIVE_BUNDLE_URL__;

  function markReady() {
    window.__velloo_live_ready = true;
    window.__velloo_live.ready = true;
  }
  // Measure the content the real component rendered into a marker's overlay
  // mount and reserve it as the marker's height. Only for fit:"content"
  // markers (aspect-video locks its own ratio). The mount is out of flow
  // (absolute; inset:0), so without this the marker would only be as tall as
  // the hidden skeleton — charts overflow their card and the page captures
  // short.
  //
  // We measure the union of the mounted CHILDREN's boxes, not the overlay's
  // own scrollHeight: an inset:0 overlay's client box is pinned to the
  // marker's height, so its scrollHeight reads back the marker height (or the
  // viewport) and would over-reserve. The children's intrinsic extent is the
  // real chart height. No-op if it would shrink the marker (never reserve
  // LESS than already laid out).
  function reserveContentHeight(marker) {
    if (marker.getAttribute('data-live-fit') !== 'content') return;
    var mount = marker.querySelector('[data-live-mount]');
    if (!mount) return;
    var mountTop = mount.getBoundingClientRect().top;
    var measured = 0;
    var kids = mount.children;
    for (var i = 0; i < kids.length; i++) {
      var r = kids[i].getBoundingClientRect();
      var bottom = r.bottom - mountTop;
      if (bottom > measured) measured = bottom;
    }
    measured = Math.ceil(measured);
    if (measured <= 0) return;
    var current = marker.getBoundingClientRect().height;
    if (measured <= current) return;
    marker.style.minHeight = measured + 'px';
  }

  // Wait until the island subtrees stop mutating, then mark ready. Charts
  // animate their SVG via JS (recharts/react-smooth), which the CSS freeze
  // below can't stop — a fixed 2-frame wait would capture a mid-entry frame
  // (a Pie tweening from radius 0 reads as *empty*). Quiescence-detection
  // lands the real final frame instead, and also covers a measure-then-
  // rerender lib (ResponsiveContainer). Bounded by DEADLINE_MS so a looping
  // animation that never quiesces still flips ready.
  //
  // After quiescence we ALSO require marker heights to be stable across two
  // consecutive animation frames before flipping ready. A multi-island grid
  // reflows asynchronously (ResponsiveContainer self-measures post-mount,
  // lower rows settle later); DOM-quiescence alone could flip ready while a
  // marker is still resizing, so the screenshot would measure a stale rect.
  // Re-reserving fit:"content" heights on each stability check also lets a
  // late reflow grow the reservation. Still bounded by DEADLINE_MS so a
  // never-quiescing loop can't hang the gate.
  function settle() {
    var QUIET_MS = 250;
    var DEADLINE_MS = 5000;
    var start = Date.now();
    var lastMutation = start;
    var observer = new MutationObserver(function () {
      lastMutation = Date.now();
    });
    markers.forEach(function (m) {
      observer.observe(m, { subtree: true, childList: true, attributes: true });
    });
    function markerHeights() {
      return markers.map(function (m) {
        return Math.round(m.getBoundingClientRect().height);
      });
    }
    function sameHeights(a, b) {
      if (a.length !== b.length) return false;
      for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
      }
      return true;
    }
    var prevHeights = null;
    function tick() {
      var now = Date.now();
      var deadlineHit = now - start >= DEADLINE_MS;
      if (now - lastMutation >= QUIET_MS || deadlineHit) {
        // DOM is quiet (or we hit the deadline). Reserve content height, then
        // confirm the layout has actually stopped moving across two frames.
        markers.forEach(reserveContentHeight);
        var heights = markerHeights();
        if (deadlineHit || (prevHeights !== null && sameHeights(prevHeights, heights))) {
          observer.disconnect();
          markReady();
          return;
        }
        prevHeights = heights;
      } else {
        // A mutation reset the quiet window — restart the stability check.
        prevHeights = null;
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  const markers = Array.prototype.slice.call(document.querySelectorAll('[data-live-node]'));
  if (markers.length === 0) { markReady(); return; }

  // Freeze chart animation so screenshots capture the final frame.
  const freeze = document.createElement('style');
  freeze.textContent =
    '[data-live-node] *, .recharts-layer, .recharts-surface * { animation: none !important; transition: none !important; }';
  document.head.appendChild(freeze);

  // The ready flag must always set, even if the bundle hangs — the
  // screenshot wait keys off it.
  const cap = setTimeout(markReady, 4000);

  import(BUNDLE_URL)
    .then(function (mod) {
      if (!mod || !mod.components) {
        clearTimeout(cap);
        settle();
        return;
      }

      const mounts = markers.map(function (marker) {
        return new Promise(function (resolve) {
          const ref = marker.getAttribute('data-live-ref');
          const Comp = ref && mod.components[ref];
          // A multi-app loader exports a per-island runtime map — each
          // island must mount with ITS host app's React copy. A single-app
          // bundle exports React/createRoot at the top level (mod itself).
          const rt = (mod.runtimes && ref && mod.runtimes[ref]) || mod;
          if (!Comp || typeof rt.createRoot !== 'function' || !rt.React) { resolve(); return; }
          const React = rt.React;
          const createRoot = rt.createRoot;
          const ErrorBoundary = rt.ErrorBoundary;

          let props = {};
          try { props = JSON.parse(marker.getAttribute('data-live-props') || '{}'); } catch (e) {}

          const skeleton = marker.querySelector('[data-velloo-extension]');
          const overlay = document.createElement('div');
          overlay.setAttribute('data-live-mount', '');
          overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
          marker.appendChild(overlay);

          const root = createRoot(overlay);

          function onMounted() {
            if (skeleton) skeleton.style.visibility = 'hidden';
            resolve();
          }
          function onError() {
            // Defer DOM teardown out of React's commit phase.
            setTimeout(function () {
              try { root.unmount(); } catch (e) {}
              if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
              if (skeleton) skeleton.style.visibility = '';
            }, 0);
            resolve();
          }
          function Mounted() {
            React.useEffect(function () { onMounted(); }, []);
            return React.createElement(Comp, props);
          }

          root.render(
            React.createElement(
              ErrorBoundary,
              { onError: onError },
              React.createElement(Mounted, null),
            ),
          );
        });
      });

      Promise.allSettled(mounts).then(function () {
        clearTimeout(cap);
        settle();
      });
    })
    .catch(function () {
      clearTimeout(cap);
      settle();
    });
})();
`;
