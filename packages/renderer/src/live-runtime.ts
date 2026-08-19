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
 * `window.__velloo_live_ready` flips true once every island has mounted or
 * fallen back (with a hard timeout cap), and chart animation is frozen, so
 * the screenshot path can wait for a deterministic final frame.
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
  // Settle two frames after mounts so a measure-then-rerender lib (recharts'
  // ResponsiveContainer) paints its final frame before a screenshot.
  function settle() {
    requestAnimationFrame(function () {
      requestAnimationFrame(markReady);
    });
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
      if (!mod || !mod.components || typeof mod.createRoot !== 'function' || !mod.React) {
        clearTimeout(cap);
        settle();
        return;
      }
      const React = mod.React;
      const createRoot = mod.createRoot;
      const ErrorBoundary = mod.ErrorBoundary;

      const mounts = markers.map(function (marker) {
        return new Promise(function (resolve) {
          const ref = marker.getAttribute('data-live-ref');
          const Comp = ref && mod.components[ref];
          if (!Comp) { resolve(); return; }

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
