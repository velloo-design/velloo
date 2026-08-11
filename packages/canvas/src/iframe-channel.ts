/**
 * Parent side of the Storybook-style channel between canvas and design iframes.
 * One channel per iframe; owns its own MessageChannel ports.
 */
export type ChildMessage =
  | { type: "ready" }
  | { type: "select"; path: string | null }
  | { type: "hover"; path: string | null };

export type ParentMessage =
  | { type: "applyHighlight"; path: string }
  | { type: "clearHighlight" }
  | { type: "applyHover"; path: string }
  | { type: "clearHover" };

export interface ChannelHandlers {
  onSelect?(path: string | null): void;
  onHover?(path: string | null): void;
  onReady?(): void;
}

export class IframeChannel {
  private port: MessagePort | null = null;
  private buffered: ParentMessage[] = [];
  private ready = false;

  constructor(
    private readonly iframe: HTMLIFrameElement,
    private readonly handlers: ChannelHandlers,
  ) {}

  /** Call once, after the iframe's contentWindow is available (load event). */
  attach(): void {
    const w = this.iframe.contentWindow;
    if (!w) return;
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (ev: MessageEvent) => this.handleMessage(ev.data as ChildMessage);
    w.postMessage({ type: "__velloo_init" }, "*", [channel.port2]);
  }

  private handleMessage(msg: ChildMessage): void {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ready") {
      this.ready = true;
      for (const queued of this.buffered) this.port?.postMessage(queued);
      this.buffered = [];
      this.handlers.onReady?.();
      return;
    }
    if (msg.type === "select") this.handlers.onSelect?.(msg.path);
    else if (msg.type === "hover") this.handlers.onHover?.(msg.path);
  }

  send(msg: ParentMessage): void {
    if (!this.ready || !this.port) {
      this.buffered.push(msg);
      return;
    }
    this.port.postMessage(msg);
  }

  destroy(): void {
    this.port?.close();
    this.port = null;
    this.buffered = [];
    this.ready = false;
  }
}
