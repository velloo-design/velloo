/**
 * Parent side of the Storybook-style channel between canvas and design iframes.
 * One channel per iframe; owns its own MessageChannel ports.
 */
export interface NodeRect {
  path: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ChildMessage =
  | { type: "ready" }
  | { type: "select"; path: string | null }
  | { type: "hover"; path: string | null }
  | { type: "nodeRects"; rects: NodeRect[] }
  /**
   * Cmd/Ctrl+wheel inside the iframe. clientX/Y are in the iframe
   * document coordinates — the parent translates them into board
   * coords using the iframe's bounding rect so zoom anchors on
   * the actual cursor position, not (0,0).
   */
  | { type: "parentZoom"; deltaY: number; clientX: number; clientY: number };

export type ParentMessage =
  | { type: "applyHighlight"; path: string }
  | { type: "clearHighlight" }
  | { type: "applyHover"; path: string }
  | { type: "clearHover" }
  | {
      type: "applyVelloState";
      path: string | null;
      state: "default" | "hover" | "focus" | "active" | "disabled";
    }
  | { type: "requestRects"; paths: string[] };

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
    this.port.onmessage = (ev: MessageEvent) => this.handleMessage(ev.data as ChildMessage);
    w.postMessage({ type: "__velloo_init" }, "*", [channel.port2]);
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

  private handleMessage(msg: ChildMessage): void {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ready") {
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
