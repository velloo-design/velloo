import { COMPUTED_PROPS, HOVER_RING, PROTOCOL_VERSION, SELECT_RING } from "./iframe-protocol.ts";

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

  // Inject highlight styles once. The ring is an outline pulled inside the
  // border box by a negative offset: it lands where an inset shadow would,
  // so an element at the iframe edge still shows a whole ring, but outlines
  // paint on top of the stacking context rather than in the element's own
  // background layer. An inset shadow sits *under* the descendants, so
  // selecting anything whose child fills it — a Card inside the screen root
  // — hid all but the few pixels the child didn't cover. Outline also leaves
  // the design's own box-shadow alone, which the !important shadow ate.
  const style = document.createElement('style');
  style.textContent =
    // Widths come from custom properties the parent drives with the board
    // zoom via setChromeScale: the iframe is scaled, so a fixed 2px ring grows
    // into a slab that swallows the parent's zoom-constant resize grips.
    ":root { --velloo-ring: 2px; --velloo-ring-hover: 1px; --velloo-ring-select: 0px; }" +
    ".__velloo-hover { outline: var(--velloo-ring-hover) solid ${HOVER_RING} !important;" +
    " outline-offset: calc(-1 * var(--velloo-ring-hover)) !important; }" +
    // The SELECTION box is normally not drawn here, hence the 0px default. An
    // outline follows the element's border-radius, so on a rounded card the
    // corner grips — which mark the bounding box a resize drag actually
    // operates on — floated outside the visible line by radius x 0.29 x zoom.
    // The board draws a square-cornered box in the parent instead and the grips
    // land on it at any radius. Hover stays an outline: it has no handles to
    // agree with, and hugging the real shape reads better for a transient cue.
    // A preview with no grips and no parent overlay — the snippet editor — opts
    // in by widening the property (buildDocument's selectionRing option),
    // because a click there would otherwise select silently.
    ".__velloo-selected { outline: var(--velloo-ring-select) solid ${SELECT_RING} !important;" +
    " outline-offset: calc(-1 * var(--velloo-ring-select)) !important; }" +
    // The rest of the screen while a snippet is being edited in place.
    ".__velloo-dimmed { opacity: 0.28 !important; filter: saturate(0.4) !important; }" +
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

  // While a snippet is focused, clicks inside its instances address the
  // definition instead of the instance — which is what makes an edit show up
  // in every instance at once.
  let focusedSnippet = null;

  function findSnippetPath(target) {
    if (focusedSnippet === null) return undefined;
    let el = target;
    while (el && el.nodeType === 1) {
      if (el.getAttribute && el.getAttribute('data-snippet-id') === focusedSnippet) {
        const p = el.getAttribute('data-snippet-path');
        return p === null ? undefined : p;
      }
      el = el.parentElement;
    }
    return undefined;
  }

  // Which instance the click landed in, as an index into the same outermost set
  // reportRects measures — so the parent can anchor the grips to the instance
  // the user actually pointed at rather than to whichever one renders first.
  function instanceIndex(target, snippetPath) {
    const all = outermost(document.querySelectorAll(snippetSelector(snippetPath)));
    for (let i = 0; i < all.length; i++) {
      if (all[i] === target || all[i].contains(target)) return i;
    }
    return 0;
  }

  function nearestSnippetId(target) {
    let el = target;
    while (el && el.nodeType === 1) {
      const id = el.getAttribute && el.getAttribute('data-snippet-id');
      if (id) return id;
      el = el.parentElement;
    }
    return undefined;
  }

  function applySnippetFocus(snippetId) {
    focusedSnippet = snippetId || null;
    document
      .querySelectorAll('.__velloo-dimmed')
      .forEach((el) => el.classList.remove('__velloo-dimmed'));
    if (focusedSnippet === null) return;
    // Dim by walking down from the root and stopping at the first element that
    // either is, or contains, an instance — so the instances stay bright
    // without needing to out-stack a full-page overlay.
    // Only instances that are actually rendered count. When a canvas bundle
    // mounts it hides the SSR copy rather than removing it, and a hidden
    // element still matches a selector — so an unfiltered query finds the
    // stale copy, clears the "no instances" guard below, and then dims the
    // entire visible tree because none of the matches live in it.
    const live = [].filter.call(
      document.querySelectorAll('[data-snippet-id="' + focusedSnippet.replace(/"/g, '\\"') + '"]'),
      (el) => el.getClientRects().length > 0,
    );
    if (live.length === 0) return;
    const dim = (el) => {
      for (let i = 0; i < el.children.length; i++) {
        const child = el.children[i];
        let isLive = false;
        let holdsLive = false;
        for (let j = 0; j < live.length; j++) {
          if (child === live[j]) isLive = true;
          else if (child.contains(live[j])) holdsLive = true;
        }
        if (isLive) continue;
        if (holdsLive) dim(child);
        else child.classList.add('__velloo-dimmed');
      }
    };
    dim(document.body);
  }

  function clearClass(cls) {
    document.querySelectorAll('.' + cls).forEach((el) => el.classList.remove(cls));
  }

  // The repo-backed canvas mount leaves the SSR tree in the document, hidden,
  // so a failed mount can restore it — but it strips the identity attributes
  // off that copy the moment it commits (CANVAS_RUNTIME's dropIdentity). So a
  // path resolves to the rendered element and these can be plain lookups; if
  // that ever stops being true the symptom is a 0x0 rect, which the
  // canvas-mount e2e suite asserts against.
  function pathSelector(path) {
    return '[data-node-path="' + String(path).replace(/"/g, '\\"') + '"]';
  }

  function snippetSelector(snippetPath) {
    return '[data-snippet-id="' + focusedSnippet.replace(/"/g, '\\"') + '"][data-snippet-path="' + String(snippetPath).replace(/"/g, '\\"') + '"]';
  }

  // Every element inside a snippet body carries the body's own path, so a
  // nested match is a descendant of the instance the user means, not another
  // instance. Keep only the outermost of each chain — the same set the ring
  // draws on, so grips and ring land on the same boxes.
  function outermost(els) {
    const out = [];
    for (let i = 0; i < els.length; i++) {
      let nested = false;
      for (let j = 0; j < els.length; j++) {
        if (i !== j && els[j].contains(els[i]) && els[j] !== els[i]) nested = true;
      }
      if (!nested) out.push(els[i]);
    }
    return out;
  }

  function applyHighlight(path, cls, scroll, snippetPath) {
    clearClass(cls);
    let els;
    if (snippetPath !== undefined && snippetPath !== null && focusedSnippet !== null) {
      // One definition path, every instance of it — the point of editing in
      // place is seeing all of them respond.
      els = document.querySelectorAll(snippetSelector(snippetPath));
    } else if (path !== null && path !== undefined) {
      els = document.querySelectorAll(pathSelector(path));
    } else {
      return;
    }
    // Every element inside a snippet body reports the *instance* path, so a
    // plain match would ring all of them. Only the outermost of each nesting
    // chain is the thing the user picked.
    let first = null;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.parentElement && el.parentElement.closest('.' + cls)) continue;
      el.classList.add(cls);
      if (first === null) first = el;
    }
    if (scroll && first) first.scrollIntoView({ block: 'center', inline: 'nearest' });
  }

  function applyVelloState(path, state) {
    // Clear any prior force-state attributes.
    document
      .querySelectorAll('[data-velloo-state]')
      .forEach((el) => el.removeAttribute('data-velloo-state'));
    if (!state || state === 'default' || path === null || path === undefined) return;
    const el = document.querySelector(pathSelector(path));
    if (el) el.setAttribute('data-velloo-state', state);
  }

  // Rects go stale on their own: a webfont swaps and a heading grows a line,
  // an image decodes and pushes everything down. The parent can't know, so the
  // last requested set is re-measured whenever the layout moves and re-sent
  // only when it actually differs — anchors and the selection handles both
  // ride on this.
  let lastRectPaths = [];
  let lastRectSnippetPaths = [];
  let lastRectsJson = '';
  let observedEls = [];
  let rectTimer = 0;

  function remeasureSoon() {
    if (rectTimer || (lastRectPaths.length === 0 && lastRectSnippetPaths.length === 0)) return;
    rectTimer = setTimeout(() => {
      rectTimer = 0;
      reportRects(lastRectPaths, lastRectSnippetPaths);
    }, 80);
  }

  const hasRO = typeof ResizeObserver === 'function';
  // The document catches reflow from anywhere; the per-element observer catches
  // a node that changes size without moving the page.
  if (hasRO) new ResizeObserver(remeasureSoon).observe(document.documentElement);
  const elObserver = hasRO ? new ResizeObserver(remeasureSoon) : null;

  function reportRects(paths, snippetPaths) {
    lastRectPaths = paths;
    lastRectSnippetPaths = snippetPaths || [];
    const rects = [];
    const els = [];
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const el = document.querySelector(pathSelector(path));
      if (!el) continue;
      els.push(el);
      const r = el.getBoundingClientRect();
      rects.push({ path: path, x: r.left, y: r.top, w: r.width, h: r.height });
    }
    // A definition path resolves to one box per instance, all of them ringed
    // and all of them draggable — the edit reaches the definition either way.
    for (let i = 0; i < lastRectSnippetPaths.length && focusedSnippet !== null; i++) {
      const path = lastRectSnippetPaths[i];
      const found = outermost(document.querySelectorAll(snippetSelector(path)));
      for (let j = 0; j < found.length; j++) {
        els.push(found[j]);
        const r = found[j].getBoundingClientRect();
        rects.push({ path: path, x: r.left, y: r.top, w: r.width, h: r.height, snippet: true });
      }
    }
    // Re-observe only when the element set changed, or observing would retrigger
    // the observer forever.
    if (elObserver && (els.length !== observedEls.length || els.some((el, i) => el !== observedEls[i]))) {
      elObserver.disconnect();
      for (let i = 0; i < els.length; i++) elObserver.observe(els[i]);
      observedEls = els;
    }
    const json = JSON.stringify(rects);
    if (json === lastRectsJson) return;
    lastRectsJson = json;
    send({ type: 'nodeRects', rects: rects });
  }

  var COMPUTED_PROPS = ${JSON.stringify(COMPUTED_PROPS)};

  // What a slot the node says nothing about actually resolves to. The parent
  // shows it greyed, so the field reads "16" rather than a dash.
  function reportComputed(path) {
    const el = document.querySelector(pathSelector(path));
    if (!el) return;
    const cs = getComputedStyle(el);
    const values = {};
    for (let i = 0; i < COMPUTED_PROPS.length; i++) {
      values[COMPUTED_PROPS[i]] = cs[COMPUTED_PROPS[i]];
    }
    send({ type: 'nodeComputed', computed: { path: path, values: values } });
  }

  // The board's zoom, turned into ring widths that stay constant on screen.
  function setChromeScale(scale) {
    const s = typeof scale === 'number' && scale > 0 ? scale : 1;
    document.documentElement.style.setProperty('--velloo-ring', (2 / s) + 'px');
    document.documentElement.style.setProperty('--velloo-ring-hover', (1 / s) + 'px');
  }

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (lastRectPaths.length > 0) reportRects(lastRectPaths);
    });
  }

  function handleParentMessage(ev) {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'applyHighlight') applyHighlight(msg.path, SELECT_CLASS, msg.scroll === true, msg.snippetPath);
    else if (msg.type === 'clearHighlight') clearClass(SELECT_CLASS);
    else if (msg.type === 'applyHover') applyHighlight(msg.path, HOVER_CLASS, false, msg.snippetPath);
    else if (msg.type === 'clearHover') clearClass(HOVER_CLASS);
    else if (msg.type === 'applyVelloState') applyVelloState(msg.path, msg.state);
    else if (msg.type === 'requestRects') reportRects(msg.paths || [], msg.snippetPaths || []);
    else if (msg.type === 'requestComputed') reportComputed(msg.path);
    else if (msg.type === 'setChromeScale') setChromeScale(msg.scale);
    else if (msg.type === 'applySnippetFocus') applySnippetFocus(msg.snippetId);
    else if (msg.type === 'restoreScroll') window.scrollTo(msg.x || 0, msg.y || 0);
  }

  function send(msg) {
    if (port) port.postMessage(msg);
  }

  /** In focus mode, only the focused snippet's own nodes are interactive. */
  function outsideFocus(target) {
    return focusedSnippet !== null && findSnippetPath(target) === undefined;
  }

  document.addEventListener('click', (ev) => {
    const path = findPath(ev.target);
    ev.preventDefault();
    // Focus mode scopes the screen to one snippet: the dimmed rest of the
    // screen isn't editable, so clicking it deselects rather than selecting
    // something the bar can't act on.
    if (outsideFocus(ev.target)) {
      send({ type: 'select', path: null });
      return;
    }
    const snippetPath = findSnippetPath(ev.target);
    // null path = empty space inside the frame → parent clears selection.
    if (snippetPath === undefined) send({ type: 'select', path: path });
    else send({ type: 'select', path: path, snippetPath: snippetPath, instance: instanceIndex(ev.target, snippetPath) });
  }, true);

  // Double-click is "open up what this is made of" — the parent turns it into
  // snippet focus when the target is an instance.
  document.addEventListener('dblclick', (ev) => {
    ev.preventDefault();
    // The way back out: double-clicking anything that isn't the snippet being
    // edited — including empty space, which has no path to report.
    if (outsideFocus(ev.target)) {
      send({ type: 'exit' });
      return;
    }
    const path = findPath(ev.target);
    if (path === null) return;
    const snippetId = nearestSnippetId(ev.target);
    if (snippetId === undefined) send({ type: 'enter', path: path });
    else send({ type: 'enter', path: path, snippetId: snippetId });
  }, true);

  // Clicking a node moves keyboard focus into this document, where the
  // parent's window listener can't see it — so every canvas shortcut, Escape
  // included, went dead the moment you selected something. Forward the keys
  // the design surface has no use of and let the parent own them.
  document.addEventListener('keydown', (ev) => {
    const el = ev.target;
    const tag = el && el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (el && el.isContentEditable)) {
      return;
    }
    send({ type: 'key', key: ev.key, metaKey: ev.metaKey === true, ctrlKey: ev.ctrlKey === true, shiftKey: ev.shiftKey === true, altKey: ev.altKey === true });
  });

  // Hover reports coalesce to one message per animation frame — sweeping the
  // cursor across a dense tree otherwise floods the parent with a store
  // update + a React render pass per crossed node.
  let hoverRaf = 0;
  let pendingHoverSnippet;
  function flushHover() {
    hoverRaf = 0;
    if (pendingHoverSnippet === undefined) send({ type: 'hover', path: pendingHover });
    else send({ type: 'hover', path: pendingHover, snippetPath: pendingHoverSnippet });
  }

  document.addEventListener('mouseover', (ev) => {
    // Nothing outside the focused snippet is editable, so nothing outside it
    // should light up as though it were.
    const path = outsideFocus(ev.target) ? null : findPath(ev.target);
    const snippetPath = findSnippetPath(ev.target);
    if (path === pendingHover && snippetPath === pendingHoverSnippet) return;
    pendingHover = path;
    pendingHoverSnippet = snippetPath;
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
