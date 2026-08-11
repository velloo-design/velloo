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

  // Inject highlight styles once.
  const style = document.createElement('style');
  style.textContent = ".__velloo-hover { outline: 1px dashed #60a5fa !important; outline-offset: 1px !important; } .__velloo-selected { outline: 2px solid #2563eb !important; outline-offset: 1px !important; }";
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

  function handleParentMessage(ev) {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'applyHighlight') applyHighlight(msg.path, SELECT_CLASS);
    else if (msg.type === 'clearHighlight') clearClass(SELECT_CLASS);
    else if (msg.type === 'applyHover') applyHighlight(msg.path, HOVER_CLASS);
    else if (msg.type === 'clearHover') clearClass(HOVER_CLASS);
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
