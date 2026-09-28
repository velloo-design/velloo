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
  document.addEventListener('htmx:afterRequest', () => { pending = Math.max(0, pending - 1); settle(); });
  const fail = (label) => (event) => {
    const failures = window.__velloo_host_failures;
    if (failures.length < 20) failures.push(label(event) + ' ' + hostPath(event.detail.requestConfig?.path ?? ''));
  };
  document.addEventListener('htmx:responseError', fail((event) => String(event.detail.xhr?.status ?? 'error')));
  document.addEventListener('htmx:sendError', fail(() => 'unreachable'));
  document.addEventListener('htmx:timeout', fail(() => 'timeout'));
  document.addEventListener('htmx:beforeSwap', (event) => {
    if (!event.detail.boosted) return;
    const fragment = event.detail.requestConfig?.elt?.closest?.('[data-velloo-html-fragment]');
    if (!fragment) return;
    if (event.detail.target === document.body) event.detail.target = fragment;
    const path = event.detail.requestConfig?.path;
    if (path?.startsWith(PROXY + '/')) fragment.setAttribute('data-velloo-host-path', hostPath(path));
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
