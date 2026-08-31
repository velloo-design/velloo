import { PROTOCOL_VERSION } from "./iframe-protocol.ts";

/**
 * Inlined into every rendered design HTML doc. Establishes a Storybook-style
 * MessageChannel with the parent canvas, reports clicks/hover with the
 * data-node-path of the closest ancestor, and applies highlights when the
 * parent asks for them. Parent owns selection; iframe is a thin reporter.
 *
 * This is a raw JS string, so it can't be type-checked against the
 * iframe-protocol unions — __tests__/iframe-protocol.test.ts greps the
 * source for message literals to catch drift, and the handshake carries
 * PROTOCOL_VERSION (interpolated below) so a stale doc fails loudly.
 */
export const IFRAME_RUNTIME = String.raw`
(() => {
  if (window.__velloo) return;
  const PROTOCOL_VERSION = ${PROTOCOL_VERSION};
  let port = null;
  let pendingHover = null;

  const SELECT_CLASS = '__velloo-selected';
  const HOVER_CLASS = '__velloo-hover';

  // Inject highlight styles once. Use inset box-shadow instead of
  // outline so the ring stays inside the element — outline + a
  // positive offset extends past the element border, and elements
  // near the iframe edge get the ring clipped by the iframe's
  // bounding box. Inset shadow draws at the element's inner edge
  // and is always fully visible regardless of position.
  const style = document.createElement('style');
  style.textContent =
    ".__velloo-hover { box-shadow: inset 0 0 0 1px #60a5fa !important; }" +
    ".__velloo-selected { box-shadow: inset 0 0 0 2px #2563eb !important; }" +
    // Scrollable frames need a *visible* affordance: wheel events forward to
    // the canvas (pan), so dragging a bar is the way to scroll — but macOS
    // overlay scrollbars stay hidden until scrolled, and (verified in real
    // Chrome) neither ::-webkit-scrollbar styling nor the standard
    // properties reliably force persistent bars there. So the runtime draws
    // its own thumb (below) whenever the native bar takes no layout space,
    // and these rules style the native bar on platforms where it does.
    // Standard properties gated away from engines with the webkit pseudo —
    // in Chrome 121+ they'd override and disable the webkit styling.
    "::-webkit-scrollbar { width: 11px; height: 11px; }" +
    "::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent; }" +
    "::-webkit-scrollbar-thumb { background: rgba(127,127,127,0.55); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }" +
    "::-webkit-scrollbar-thumb:hover { background: rgba(127,127,127,0.85); }" +
    "@supports not selector(::-webkit-scrollbar) { html { scrollbar-width: thin; scrollbar-color: rgba(127,127,127,0.55) transparent; } }" +
    ".__velloo-scrollthumb { position: fixed; right: 2px; width: 9px; border-radius: 999px;" +
    " background: rgba(127,127,127,0.55); box-shadow: 0 0 0 1px rgba(255,255,255,0.35);" +
    " z-index: 2147483646; display: none; }" +
    ".__velloo-scrollthumb:hover, .__velloo-scrollthumb[data-dragging] { background: rgba(127,127,127,0.9); }";
  document.head.appendChild(style);

  // Persistent scroll indicator, drawn by the runtime (design-mode only).
  // Hidden automatically on platforms whose native scrollbar already takes
  // layout space (classic bars are visible there — no need to double up).
  const thumb = document.createElement('div');
  thumb.className = '__velloo-scrollthumb';
  thumb.setAttribute('aria-hidden', 'true');
  document.body.appendChild(thumb);

  const TRACK_PAD = 2;
  function scroller() {
    return document.scrollingElement || document.documentElement;
  }

  function syncThumb() {
    const se = scroller();
    const vh = window.innerHeight;
    const sh = se.scrollHeight;
    const nativeVisible = window.innerWidth - document.documentElement.clientWidth > 0;
    // A few px of overflow (sub-pixel rounding, trailing margins) doesn't
    // warrant a thumb — only show when there's meaningful scroll range.
    if (sh - vh < 24 || nativeVisible) {
      thumb.style.display = 'none';
      return;
    }
    const trackH = vh - TRACK_PAD * 2;
    const h = Math.max(28, trackH * (vh / sh));
    const maxTop = trackH - h;
    const top = TRACK_PAD + maxTop * (se.scrollTop / (sh - vh));
    thumb.style.display = 'block';
    thumb.style.height = h + 'px';
    thumb.style.top = top + 'px';
  }

  window.addEventListener('scroll', syncThumb, { passive: true });
  window.addEventListener('resize', syncThumb, { passive: true });
  // Content height changes after fonts/images land; track the document itself.
  if (window.ResizeObserver) {
    new ResizeObserver(syncThumb).observe(document.documentElement);
  }
  syncThumb();

  // Drag the thumb to scroll. stopPropagation keeps the capture-phase click
  // reporter from treating the gesture as a selection attempt.
  thumb.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    try {
      thumb.setPointerCapture(ev.pointerId);
    } catch {
      // synthetic events carry no active pointer; drag still tracks below
    }
    thumb.setAttribute('data-dragging', '');
    const se = scroller();
    const vh = window.innerHeight;
    const startY = ev.clientY;
    const startTop = se.scrollTop;
    const trackH = vh - TRACK_PAD * 2;
    const ratio = (se.scrollHeight - vh) / Math.max(1, trackH - thumb.offsetHeight);
    const move = (e) => {
      se.scrollTop = startTop + (e.clientY - startY) * ratio;
    };
    const up = () => {
      thumb.removeAttribute('data-dragging');
      thumb.removeEventListener('pointermove', move);
      thumb.removeEventListener('pointerup', up);
      thumb.removeEventListener('pointercancel', up);
    };
    thumb.addEventListener('pointermove', move);
    thumb.addEventListener('pointerup', up);
    thumb.addEventListener('pointercancel', up);
  });

  function findPath(target) {
    if (!target) return null;
    let el = target;
    while (el && el.nodeType === 1) {
      const p = el.getAttribute && el.getAttribute('data-node-path');
      if (p !== null && p !== undefined) return p;
      el = el.parentElement;
    }
    return null;
  }

  function clearClass(cls) {
    document.querySelectorAll('.' + cls).forEach((el) => el.classList.remove(cls));
  }

  function applyHighlight(path, cls, scroll) {
    clearClass(cls);
    if (path === null || path === undefined) return;
    const el = document.querySelector('[data-node-path="' + path.replace(/"/g, '\\"') + '"]');
    if (!el) return;
    el.classList.add(cls);
    if (scroll) el.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  function applyVelloState(path, state) {
    // Clear any prior force-state attributes.
    document
      .querySelectorAll('[data-velloo-state]')
      .forEach((el) => el.removeAttribute('data-velloo-state'));
    if (!state || state === 'default' || path === null || path === undefined) return;
    const el = document.querySelector('[data-node-path="' + path.replace(/"/g, '\\"') + '"]');
    if (el) el.setAttribute('data-velloo-state', state);
  }

  function reportRects(paths) {
    const rects = [];
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const el = document.querySelector('[data-node-path="' + String(path).replace(/"/g, '\\"') + '"]');
      if (!el) continue;
      const r = el.getBoundingClientRect();
      rects.push({ path: path, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    send({ type: 'nodeRects', rects: rects });
  }

  function handleParentMessage(ev) {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'applyHighlight') applyHighlight(msg.path, SELECT_CLASS, msg.scroll === true);
    else if (msg.type === 'clearHighlight') clearClass(SELECT_CLASS);
    else if (msg.type === 'applyHover') applyHighlight(msg.path, HOVER_CLASS);
    else if (msg.type === 'clearHover') clearClass(HOVER_CLASS);
    else if (msg.type === 'applyVelloState') applyVelloState(msg.path, msg.state);
    else if (msg.type === 'requestRects') reportRects(msg.paths || []);
    else if (msg.type === 'restoreScroll') window.scrollTo(msg.x || 0, msg.y || 0);
  }

  function send(msg) {
    if (port) port.postMessage(msg);
  }

  document.addEventListener('click', (ev) => {
    const path = findPath(ev.target);
    if (path !== null) {
      ev.preventDefault();
      send({ type: 'select', path: path });
    }
  }, true);

  // Hover reports coalesce to one message per animation frame — sweeping the
  // cursor across a dense tree otherwise floods the parent with a store
  // update + a React render pass per crossed node.
  let hoverRaf = 0;
  function flushHover() {
    hoverRaf = 0;
    send({ type: 'hover', path: pendingHover });
  }

  document.addEventListener('mouseover', (ev) => {
    const path = findPath(ev.target);
    if (path === pendingHover) return;
    pendingHover = path;
    if (!hoverRaf) hoverRaf = requestAnimationFrame(flushHover);
  });

  document.addEventListener('mouseleave', () => {
    pendingHover = null;
    if (hoverRaf) {
      cancelAnimationFrame(hoverRaf);
      hoverRaf = 0;
    }
    send({ type: 'hover', path: null });
  });

  // Cmd/Ctrl + wheel inside the iframe is a "zoom the canvas" gesture
  // for the parent — without this handler the browser treats it as
  // page-zoom (especially on macOS pinch-zoom which dispatches as
  // ctrlKey+wheel). Plain wheel/trackpad-scroll is a "pan the canvas"
  // gesture — without forwarding, the iframe absorbs scroll deltas
  // (often it's smaller than its iframe, so they're a no-op) and the
  // parent sees nothing.
  //
  // We only preventDefault + forward when the parent has established a
  // channel (port is non-null). Library-tile iframes don't run a
  // handshake; preventDefault'ing their wheels would freeze the
  // surrounding masonry's scroll.
  window.addEventListener('wheel', (ev) => {
    if (!port) return;
    // Alt/Option + wheel scrolls the design document itself — the only wheel
    // path to the content, since plain wheel pans the canvas.
    if (ev.altKey) return;
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      send({ type: 'parentZoom', deltaY: ev.deltaY, clientX: ev.clientX, clientY: ev.clientY });
      return;
    }
    ev.preventDefault();
    send({ type: 'parentPan', deltaX: ev.deltaX, deltaY: ev.deltaY });
  }, { passive: false });

  // Report the document scroll offset (debounced) so the parent can restore
  // it after a reload — the iframe src embeds theme/version params, so a
  // dark-mode toggle or theme edit is a full navigation that would otherwise
  // reset scroll to the top.
  let scrollTimer = 0;
  window.addEventListener('scroll', () => {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrollTimer = 0;
      const se = document.scrollingElement || document.documentElement;
      send({ type: 'scrollPos', x: se.scrollLeft, y: se.scrollTop });
    }, 120);
  }, { passive: true });

  // Wait for the parent to send a port via window.postMessage.
  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === '__velloo_init' && ev.ports && ev.ports[0]) {
      port = ev.ports[0];
      port.onmessage = handleParentMessage;
      port.postMessage({ type: 'ready', version: PROTOCOL_VERSION });
    }
  });

  window.__velloo = { ready: true };
})();
`;
