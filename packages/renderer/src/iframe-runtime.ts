/**
 * Inlined into every rendered design HTML doc. Establishes a Storybook-style
 * MessageChannel with the parent canvas, reports clicks/hover with the
 * data-node-path of the closest ancestor, and applies highlights when the
 * parent asks for them. Parent owns selection; iframe is a thin reporter.
 */
export const IFRAME_RUNTIME = String.raw`
(() => {
  if (window.__velloo) return;
  let port = null;
  let pendingHighlight = null;
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
    ".__velloo-selected { box-shadow: inset 0 0 0 2px #2563eb !important; }";
  document.head.appendChild(style);

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

  function applyHighlight(path, cls) {
    clearClass(cls);
    if (path === null || path === undefined) return;
    const el = document.querySelector('[data-node-path="' + path.replace(/"/g, '\\"') + '"]');
    if (el) el.classList.add(cls);
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
    if (msg.type === 'applyHighlight') applyHighlight(msg.path, SELECT_CLASS);
    else if (msg.type === 'clearHighlight') clearClass(SELECT_CLASS);
    else if (msg.type === 'applyHover') applyHighlight(msg.path, HOVER_CLASS);
    else if (msg.type === 'clearHover') clearClass(HOVER_CLASS);
    else if (msg.type === 'applyVelloState') applyVelloState(msg.path, msg.state);
    else if (msg.type === 'requestRects') reportRects(msg.paths || []);
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

  document.addEventListener('mouseover', (ev) => {
    const path = findPath(ev.target);
    if (path !== pendingHover) {
      pendingHover = path;
      send({ type: 'hover', path: path });
    }
  });

  document.addEventListener('mouseleave', () => {
    pendingHover = null;
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
    if (ev.ctrlKey || ev.metaKey) {
      ev.preventDefault();
      send({ type: 'parentZoom', deltaY: ev.deltaY, clientX: ev.clientX, clientY: ev.clientY });
      return;
    }
    ev.preventDefault();
    send({ type: 'parentPan', deltaX: ev.deltaX, deltaY: ev.deltaY });
  }, { passive: false });

  // Wait for the parent to send a port via window.postMessage.
  window.addEventListener('message', (ev) => {
    if (ev.data && ev.data.type === '__velloo_init' && ev.ports && ev.ports[0]) {
      port = ev.ports[0];
      port.onmessage = handleParentMessage;
      port.postMessage({ type: 'ready' });
      if (pendingHighlight !== null) {
        send({ type: 'applyHighlight', path: pendingHighlight });
        pendingHighlight = null;
      }
    }
  });

  window.__velloo = { ready: true };
})();
`;
