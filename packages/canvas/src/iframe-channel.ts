/**
 * Parent side of the Storybook-style channel between canvas and design iframes.
 * One channel per iframe; owns its own MessageChannel ports.
 *
 * The message contract lives in @velloo/renderer's iframe-protocol module
 * — the same package whose runtime string is injected into the iframe —
 * so the two sides can't drift independently.
 */
import {
  type ChildMessage,
  INIT_MESSAGE_TYPE,
  type NodeRect,
  type ParentMessage,
  PROTOCOL_VERSION,
} from "@velloo/renderer/iframe-protocol";

export type { ChildMessage, NodeRect, ParentMessage };

export interface ChannelHandlers {
  onSelect?(path: string | null): void;
  onHover?(path: string | null): void;
  onReady?(): void;
  onRects?(rects: NodeRect[]): void;
  /**
   * Cmd/Ctrl + wheel forwarded from the iframe (pinch-zoom).
   * clientX/Y are coordinates inside the iframe document; the
   * receiver translates them to canvas coords via the iframe's
   * bounding rect to anchor zoom on the cursor.
   */
  onParentZoom?(deltaY: number, clientX: number, clientY: number): void;
  /** Plain wheel/trackpad-scroll forwarded from the iframe (pan). */
  onParentPan?(deltaX: number, deltaY: number): void;
  /** Debounced document scroll offset — saved for post-reload restore. */
  onScrollPos?(x: number, y: number): void;
}

const INIT_RETRY_MS = 150;
const INIT_MAX_ATTEMPTS = 20;

export class IframeChannel {
  private port: MessagePort | null = null;
  private buffered: ParentMessage[] = [];
  private ready = false;
  private destroyed = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;

  constructor(
    private readonly iframe: HTMLIFrameElement,
    private readonly handlers: ChannelHandlers,
  ) {}

  /**
   * Begin (or restart) the handshake. Safe to call multiple times —
   * extra calls reset `ready` and start a fresh handshake. This is
   * critical for iframe reloads: when the iframe src changes (e.g. a
   * prop edit bumps `screenVersion` and we cache-bust), the iframe
   * loads new HTML with a fresh runtime that doesn't know about the
   * old port. Without re-handshaking, the new iframe is mute — clicks
   * and hovers never reach the parent and the canvas pointer-tool
   * appears stuck.
   *
   * Retries every `INIT_RETRY_MS` until the child posts `ready` or
   * attempts run out. Defeats the race where `__velloo_init` lands
   * before the iframe runtime has registered its `message` listener.
   */
  attach(): void {
    if (this.destroyed) return;
    this.cancelRetry();
    // Close the previous port so the old runtime stops receiving on a
    // dead channel; reset `ready` so handleMessage will re-fire onReady
    // and we'll re-send any buffered messages once the new child
    // acknowledges.
    this.port?.close();
    this.port = null;
    this.ready = false;
    this.attempts = 0;
    this.sendInit();
  }

  private sendInit(): void {
    if (this.destroyed || this.ready) return;
    const w = this.iframe.contentWindow;
    if (!w) {
      this.scheduleRetry();
      return;
    }
    this.attempts += 1;
    // Each attempt creates fresh ports so the old port (if any) gets
    // garbage-collected when we re-try. The previous port's onmessage
    // never fires because the child hasn't kept a reference yet.
    this.port?.close();
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (ev: MessageEvent) => this.handleMessage(ev.data);
    w.postMessage({ type: INIT_MESSAGE_TYPE, version: PROTOCOL_VERSION }, "*", [channel.port2]);
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.destroyed || this.ready) return;
    if (this.attempts >= INIT_MAX_ATTEMPTS) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.ready || this.destroyed) return;
      this.sendInit();
    }, INIT_RETRY_MS);
  }

  private cancelRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private handleMessage(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    if (typeof (raw as { type?: unknown }).type !== "string") return;
    const msg = raw as ChildMessage;
    if (msg.type === "ready") {
      if (msg.version !== PROTOCOL_VERSION) {
        // Stale iframe doc (cached HTML from an older runtime). Keep
        // operating best-effort, but say so — silent protocol drift is
        // exactly what the version field exists to catch.
        console.error(
          `velloo: iframe protocol mismatch — canvas v${PROTOCOL_VERSION}, iframe v${msg.version ?? "<unversioned>"}. Reload the page.`,
        );
      }
      this.ready = true;
      this.cancelRetry();
      for (const queued of this.buffered) this.port?.postMessage(queued);
      this.buffered = [];
      this.handlers.onReady?.();
      return;
    }
    if (msg.type === "select") this.handlers.onSelect?.(msg.path);
    else if (msg.type === "hover") this.handlers.onHover?.(msg.path);
    else if (msg.type === "nodeRects") this.handlers.onRects?.(msg.rects);
    else if (msg.type === "parentZoom")
      this.handlers.onParentZoom?.(msg.deltaY, msg.clientX, msg.clientY);
    else if (msg.type === "parentPan") this.handlers.onParentPan?.(msg.deltaX, msg.deltaY);
    else if (msg.type === "scrollPos") this.handlers.onScrollPos?.(msg.x, msg.y);
  }

  send(msg: ParentMessage): void {
    if (!this.ready || !this.port) {
      this.buffered.push(msg);
      return;
    }
    this.port.postMessage(msg);
  }

  destroy(): void {
    this.destroyed = true;
    this.cancelRetry();
    this.port?.close();
    this.port = null;
    this.buffered = [];
    this.ready = false;
  }
}
