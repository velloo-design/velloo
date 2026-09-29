/**
 * The document side of a server-driven host runtime (`HostRuntimeSpec` in
 * `@velloo/provider`). The daemon serves the runtime script and proxies the
 * host app under these paths; the design document re-routes every host request
 * through the proxy and reports when the page has gone quiet.
 */

/** Where the daemon mounts its host-runtime routes. */
export const HOST_ROUTES_BASE = "/api/html";
/** Root of the daemon's reverse proxy to `hostApp.previewUrl`. */
export const HOST_PROXY_PREFIX = `${HOST_ROUTES_BASE}/host`;
/** Where the daemon serves the htmx runtime script. */
export const HTMX_RUNTIME_PATH = `${HOST_ROUTES_BASE}/htmx.js`;
/** Id of the inline boot script — also how a capture knows to wait for the host. */
export const HOST_RUNTIME_SCRIPT_ID = "velloo-host-runtime";
/** Marks the notice a fragment shows in place of content it couldn't load. */
export const HOST_NOTICE_ATTRIBUTE = "data-velloo-host-notice";
/** Marks a host stylesheet `<link>` with the path it was configured as. */
export const HOST_STYLESHEET_ATTRIBUTE = "data-velloo-host-stylesheet";

export interface HostRuntimeOptions {
  kind: "htmx";
  /** Host stylesheets: root-relative paths go through the proxy, https URLs load as-is. */
  stylesheets?: string[] | undefined;
}

/** What a capture found about the host runtime when it took the shot. */
export interface HostRuntimeState {
  settled: boolean;
  pending: number;
  /** One line per failed host request, e.g. `503 /contacts` or `500 stylesheet /static/site.css`. */
  failures: string[];
}

/** Flags the boot script keeps on `window` for captures to read. */
export type HostRuntimeFlags = {
  __velloo_host_ready?: boolean;
  __velloo_host_pending?: number;
  __velloo_host_failures?: string[];
};

export function documentHasHostRuntime(html: string): boolean {
  return html.includes(`id="${HOST_RUNTIME_SCRIPT_ID}"`);
}

// Requests from a fragment resolve against the host route that fragment
// currently shows (it changes as boosted links navigate inside it); requests
// from editable nodes resolve against the screen's own route. Anything already
// absolute or already proxied is left for htmx's selfRequestsOnly to judge.
const HTMX_BOOT = `
(() => {
  const PROXY = __PROXY__;
  const screenRoute = __ROUTE__;
  let pending = 0;
  let quietTimer;
  window.__velloo_host_ready = false;
  window.__velloo_host_pending = 0;
  window.__velloo_host_failures = [];
  const settle = () => {
    clearTimeout(quietTimer);
    window.__velloo_host_pending = pending;
    if (pending === 0) quietTimer = setTimeout(() => { window.__velloo_host_ready = true; }, 300);
  };
  const hostPath = (path) => path.startsWith(PROXY + '/') ? path.slice(PROXY.length) : path;
  // On the canvas a design shows what it holds. A click selects — htmx would
  // act on it anyway, swapping the design for whatever the app answers — and
  // the design's own hx-* loaders wait for a preview, so a design never turns
  // into the app's current data, or its sign-in page, by being looked at. Only
  // an HtmlFragment, which is a live view by definition, loads on the canvas.
  // A preview (\`?interact=1\`) runs everything.
  const interactive = new URLSearchParams(location.search).get('interact') === '1';
  document.addEventListener('htmx:confirm', (event) => {
    if (interactive) return;
    const live = event.detail.elt?.closest?.('[data-velloo-html-fragment]');
    if (event.detail.triggeringEvent?.isTrusted || !live) event.preventDefault();
  });
  document.addEventListener('htmx:configRequest', (event) => {
    let path = event.detail.path;
    if (!path.startsWith('//') && !path.startsWith(PROXY + '/') && !/^[a-z][a-z0-9+.-]*:/i.test(path)) {
      const fragment = event.detail.elt?.closest?.('[data-velloo-html-fragment]');
      const basePath = fragment?.getAttribute('data-velloo-host-path') || screenRoute;
      const resolved = new URL(path, 'http://velloo-host' + basePath);
      path = PROXY + resolved.pathname + resolved.search;
    }
    // The document shares the daemon's origin, so a request that leaves the
    // proxy — an absolute URL, or a proxy path climbing out with ../ — would
    // reach the daemon's own API. Judge the path the browser will send.
    const target = new URL(path, location.href);
    if (target.origin !== location.origin || !target.pathname.startsWith(PROXY + '/')) {
      event.preventDefault();
      return;
    }
    event.detail.path = target.pathname + target.search;
  });
  document.addEventListener('htmx:beforeRequest', () => {
    pending++;
    window.__velloo_host_ready = false;
    window.__velloo_host_pending = pending;
    clearTimeout(quietTimer);
  });
  // A fragment's own load that ends on another route was redirected — most
  // often to the app's sign-in, which is not the page the design shows.
  const redirectOf = (event) => {
    const elt = event.detail.elt;
    const landed = event.detail.xhr?.responseURL;
    if (!landed || elt?.getAttribute?.('hx-trigger') !== 'load' || !elt.closest?.('[data-velloo-html-fragment]')) return null;
    const asked = hostPath(new URL(event.detail.requestConfig?.path ?? '/', location.href).pathname);
    const got = hostPath(new URL(landed).pathname);
    return got === asked ? null : { asked, got };
  };
  document.addEventListener('htmx:afterRequest', (event) => {
    pending = Math.max(0, pending - 1);
    const redirect = redirectOf(event);
    const failures = window.__velloo_host_failures;
    if (redirect && failures.length < 20) failures.push('redirected ' + redirect.asked + ' → ' + redirect.got);
    settle();
  });
  // A fragment whose first load failed would otherwise stay an empty box:
  // say what went wrong where the content should be. Text only — the reason
  // is the proxy's (or the app's) response body.
  const notify = (event, heading, body) => {
    const elt = event.detail.elt;
    if (elt?.getAttribute?.('hx-trigger') !== 'load') return;
    const fragment = elt.closest?.('[data-velloo-html-fragment]');
    if (!fragment) return;
    const box = document.createElement('div');
    box.setAttribute('${HOST_NOTICE_ATTRIBUTE}', '');
    box.style.cssText = 'margin:16px;padding:16px;border:1px dashed #d4a017;border-radius:8px;background:#fffbeb;color:#713f12;font:13px/1.5 system-ui,sans-serif;white-space:normal';
    const title = document.createElement('strong');
    title.textContent = heading;
    box.append(title);
    if (body) {
      const detail = document.createElement('div');
      detail.textContent = body;
      box.append(detail);
    }
    const tag = fragment.localName;
    let holder = box;
    if (tag === 'tr') {
      holder = document.createElement('td');
      holder.colSpan = 99;
      holder.append(box);
    } else if (tag === 'tbody' || tag === 'thead' || tag === 'tfoot' || tag === 'table') {
      const cell = document.createElement('td');
      cell.colSpan = 99;
      cell.append(box);
      holder = document.createElement('tr');
      holder.append(cell);
    }
    fragment.replaceChildren(holder);
  };
  const fail = (label) => (event) => {
    const failures = window.__velloo_host_failures;
    if (failures.length < 20) failures.push(label(event) + ' ' + hostPath(event.detail.requestConfig?.path ?? ''));
    const path = hostPath(event.detail.requestConfig?.path ?? '');
    const body = String(event.detail.xhr?.responseText ?? '').replace(/<[^>]*>/g, ' ').replace(/\\s+/g, ' ').trim().slice(0, 240);
    notify(event, "Couldn't load " + path + ' from the app (' + label(event) + ')', body);
  };
  document.addEventListener('htmx:responseError', fail((event) => String(event.detail.xhr?.status ?? 'error')));
  document.addEventListener('htmx:sendError', fail(() => 'unreachable'));
  document.addEventListener('htmx:timeout', fail(() => 'timeout'));
  // HX-Redirect / HX-Location / HX-Refresh would move the whole document —
  // off the design, onto a daemon path that is no page. A sign-in form is the
  // usual sender. Load the destination into the fragment that asked instead;
  // anywhere else, reload the design.
  document.addEventListener('htmx:beforeOnLoad', (event) => {
    const xhr = event.detail.xhr;
    let to = xhr.getResponseHeader('HX-Redirect');
    const hxLocation = xhr.getResponseHeader('HX-Location');
    if (!to && hxLocation) {
      try {
        to = hxLocation.startsWith('{') ? JSON.parse(hxLocation).path : hxLocation;
      } catch {
        to = null;
      }
    }
    if (!to && xhr.getResponseHeader('HX-Refresh') !== 'true') return;
    event.preventDefault();
    const fragment = event.detail.elt?.closest?.('[data-velloo-html-fragment]');
    if (!to || !fragment || !window.htmx) {
      location.reload();
      return;
    }
    const from = hostPath(event.detail.requestConfig?.path ?? '/');
    const target = new URL(hostPath(String(to)), 'http://velloo-host' + from);
    fragment.setAttribute('data-velloo-host-path', target.pathname);
    window.htmx.ajax('GET', PROXY + target.pathname + target.search, { target: fragment, swap: 'innerHTML' });
  });
  // On the canvas a redirected fragment shows why rather than the page it was
  // sent to: a sign-in form standing in for the design would read as the
  // design. The canvas never signs in to the app; a capture session does.
  document.addEventListener('htmx:beforeSwap', (event) => {
    if (interactive) return;
    const redirect = redirectOf(event);
    if (!redirect) return;
    event.detail.shouldSwap = false;
    notify(
      event,
      'The app sends ' + redirect.asked + ' to ' + redirect.got,
      "Usually that's its sign-in. The canvas doesn't sign in to your app: capture the page with a capture session (start_capture_session) and build the design from the capture.",
    );
  });
  document.addEventListener('htmx:beforeSwap', (event) => {
    if (!event.detail.boosted) return;
    const fragment = event.detail.requestConfig?.elt?.closest?.('[data-velloo-html-fragment]');
    if (!fragment) return;
    if (event.detail.target === document.body) event.detail.target = fragment;
    const path = event.detail.requestConfig?.path;
    if (path?.startsWith(PROXY + '/')) fragment.setAttribute('data-velloo-host-path', hostPath(path));
  });
  // A fragment that loads a whole page takes only the body's children; the
  // body's own layout (\`class="flex"\`, a centered grid) goes with the rest of
  // the document. Carry its class and style onto the fragment, which stands
  // where that body was — and nothing else, no handlers.
  document.addEventListener('htmx:beforeSwap', (event) => {
    const fragment = event.detail.target;
    if (!fragment?.matches?.('[data-velloo-html-fragment]') || !event.detail.shouldSwap) return;
    const open = /<body\\b[^>]*>/i.exec(String(event.detail.serverResponse ?? ''));
    if (!open) return;
    const body = new DOMParser().parseFromString(open[0] + '</body>', 'text/html').body;
    // htmx's own request/swap classes come and go on the fragment; they are
    // neither the design's nor the page's.
    const transient = [...fragment.classList].filter((name) => name.startsWith('htmx-'));
    if (!fragment.hasAttribute('data-velloo-own-class')) {
      const own = [...fragment.classList].filter((name) => !name.startsWith('htmx-'));
      fragment.setAttribute('data-velloo-own-class', own.join(' '));
      fragment.setAttribute('data-velloo-own-style', fragment.getAttribute('style') ?? '');
    }
    const own = (name) => fragment.getAttribute('data-velloo-own-' + name);
    const merged = (name, separator, extra = []) =>
      [own(name), body.getAttribute(name), ...extra].filter(Boolean).join(separator);
    // A refreshed snapshot already carries the body's classes; don't repeat them.
    fragment.setAttribute('class', [...new Set(merged('class', ' ', transient).split(/\\s+/))].join(' ').trim());
    fragment.setAttribute('style', merged('style', ';'));
  });
  window.addEventListener('load', settle);
})();`;

export const HTMX_CONFIG =
  "htmx.config.allowEval=false;htmx.config.allowScriptTags=false;htmx.config.selfRequestsOnly=true;htmx.config.historyEnabled=false;";

/** The boot script for a screen at `route`, with JSON-encoded placeholders filled. */
export function htmxBootScript(route: string, jsonForScript: (value: unknown) => string): string {
  return HTMX_BOOT.replace("__PROXY__", jsonForScript(HOST_PROXY_PREFIX)).replace(
    "__ROUTE__",
    jsonForScript(route),
  );
}
