import { afterAll, describe } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";
import type { Root } from "react-dom/client";

/**
 * A real DOM for canvas component tests.
 *
 * The rest of the canvas suite server-renders to a markup string, which can
 * assert what a component *outputs* but never what it *does* — no click
 * handler, no keyboard shortcut, no effect, no store round trip is reachable
 * that way. This registers happy-dom and mounts with React's own `act`, so a
 * test can drive a component the way a person does.
 *
 * **Load your component with `await import()`, not a static import.** React and
 * anything that touches `window` at module scope must initialize *after* the
 * registration below, and biome's import sorting will happily reorder a static
 * import above this one. `mount()` self-checks for that and says so.
 *
 * **Wrap your suites in `domSuite` rather than `describe`.** Registering a DOM
 * mutates the global object and binds React to it for the lifetime of the
 * module registry, so these files need one global per file. `--parallel`
 * (which implies `--isolate`) provides that and is what `bun run test` and CI
 * use; a bare serial `bun test` does not, and would leak `window` into every
 * file that runs afterwards. `domSuite` skips rather than corrupting them.
 */

/**
 * Per-file globals? `--parallel` sets a worker id. `--isolate` on its own also
 * qualifies but is not detectable, so `VELLOO_DOM_TESTS=1` forces the issue.
 */
const isolated = Boolean(process.env.BUN_TEST_WORKER_ID) || process.env.VELLOO_DOM_TESTS === "1";

/** `describe` for DOM suites — skipped when the run has no per-file globals. */
export const domSuite: typeof describe.skip = isolated
  ? describe
  : (describe.skip as typeof describe.skip);

if (isolated) {
  GlobalRegistrator.register({
    url: "http://localhost/",
    // Frames render real <iframe src="/api/render/…"> elements. happy-dom would
    // try to navigate them over the network — which no fetch stub intercepts,
    // because iframe loading doesn't go through `fetch` — filling the run with
    // aborted-request noise. The canvas never needs the inner document here:
    // what the tests drive is the parent's src/buffer bookkeeping.
    settings: { disableIframePageLoading: true },
  });
}

/**
 * happy-dom logs a DOMException for every iframe src it declines to load. That
 * is the setting above working as intended, not a failure — but a board of
 * frames would bury the run in it, so drop exactly that message and nothing
 * else.
 */
const realConsoleError = console.error;
if (isolated) {
  console.error = (...args: unknown[]) => {
    const first = args[0];
    const message = first instanceof Error ? first.message : String(first ?? "");
    if (message.includes("Iframe page loading is disabled")) return;
    realConsoleError(...args);
  };
}

// React 19 gates `act` behind this flag and warns loudly without it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Loaded *after* the register() above, not through a static import: react-dom
// captures window/document and the DOM prototypes when its module initializes,
// and ESM would hoist that above the registration. Bind it early and React's
// controlled-input tracking reads a world that no longer exists — clicks still
// work, but onChange silently never fires.
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");

const mounted: { root: Root; host: HTMLElement }[] = [];

export interface Mounted {
  /** The container the component rendered into. */
  readonly host: HTMLElement;
  /** Re-render with new children, flushing effects. */
  render(node: ReactNode): Promise<void>;
  unmount(): Promise<void>;
}

/**
 * React binds the DOM globals when its modules initialize. If that happened
 * before the registration above, clicks still work but controlled inputs go
 * dead — `onChange` never fires and the failure reads as "the component is
 * broken". Prove the wiring once, loudly, instead.
 */
let wiringChecked = false;
async function assertReactSeesTheDom(): Promise<void> {
  if (wiringChecked) return;
  wiringChecked = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let changed = false;
  await act(async () => {
    root.render(
      createElement("input", {
        onChange: () => {
          changed = true;
        },
      }),
    );
  });
  const input = host.querySelector("input") as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set?.call(
      input,
      "probe",
    );
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await act(async () => {
    root.unmount();
  });
  host.remove();
  if (!changed) {
    throw new Error(
      "React did not see happy-dom's DOM: onChange never fired. Something imported React " +
        "(or a module that touches window) before ./dom.ts registered the DOM — load your " +
        "component with `await import(...)` after importing this module.",
    );
  }
}

/** Mount a component into a fresh container, flushing effects before returning. */
export async function mount(node: ReactNode): Promise<Mounted> {
  await assertReactSeesTheDom();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const entry = { root, host };
  mounted.push(entry);

  await act(async () => {
    root.render(node);
  });

  return {
    host,
    async render(next: ReactNode) {
      await act(async () => {
        root.render(next);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      host.remove();
      const at = mounted.indexOf(entry);
      if (at >= 0) mounted.splice(at, 1);
    },
  };
}

/** Run an interaction and flush the renders and effects it schedules. */
export async function interact(fn: () => void | Promise<void>): Promise<void> {
  await act(async () => {
    await fn();
  });
}

/** Advance past a `setTimeout(…, ms)` and flush whatever it scheduled. */
export async function settle(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

/**
 * Radix renders overlays into a portal on document.body, so a query scoped to
 * the mount container would miss every dialog. Search the whole document.
 */
export function $(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

export function $$(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)];
}

/** Visible text of a node, whitespace-collapsed for readable assertions. */
export function text(node: Element | null): string {
  return (node?.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function typeInto(input: HTMLInputElement, value: string): void {
  // React tracks the last value it wrote on the DOM node; assigning `.value`
  // directly makes it believe nothing changed, so onChange never fires.
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

export function press(target: Element, key: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, ...init }));
}

afterAll(async () => {
  if (!isolated) return;
  console.error = realConsoleError;
  for (const { root, host } of mounted.splice(0)) {
    root.unmount();
    host.remove();
  }
  await GlobalRegistrator.unregister();
});
