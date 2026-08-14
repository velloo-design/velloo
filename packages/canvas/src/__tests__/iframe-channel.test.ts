import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IframeChannel, type NodeRect, type ParentMessage } from "../iframe-channel.ts";

/**
 * The iframe channel is small but easy to wedge: a stale `ready` flag
 * after an iframe reload means the parent's `__velloo_init` never
 * re-sends, and the new iframe sits mute. These tests pin the
 * handshake contract — most importantly that `attach()` always starts
 * a fresh handshake.
 */

interface PostedInit {
  port: MessagePort;
}

/**
 * Synthetic stand-in for an iframe. The MessageChannel handshake works
 * on its `contentWindow.postMessage`. Records every init the parent
 * sends so tests can simulate a child runtime that replies (or doesn't).
 */
class FakeWindow {
  posted: PostedInit[] = [];
  postMessage(msg: { type?: string }, _origin: string, transfer: Transferable[]): void {
    if (msg?.type === "__velloo_init" && transfer.length > 0) {
      const port = transfer[0] as MessagePort;
      this.posted.push({ port });
    }
  }
  /** Drain ready+arbitrary replies through the most recent port. */
  reply(msg: { type: "ready" } | { type: "select"; path: string | null }): void {
    const last = this.posted[this.posted.length - 1];
    if (!last) throw new Error("no init posted yet");
    last.port.postMessage(msg);
  }
}

class FakeIframe {
  private listeners: Record<string, ((ev: Event) => void)[]> = {};
  contentWindow = new FakeWindow();
  contentDocument = { readyState: "loading" as "loading" | "complete" };
  addEventListener(type: string, fn: (ev: Event) => void): void {
    (this.listeners[type] ??= []).push(fn);
  }
  removeEventListener(type: string, fn: (ev: Event) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
  }
  fireLoad(): void {
    for (const fn of this.listeners.load ?? []) fn(new Event("load"));
  }
}

let prevMC: typeof globalThis.MessageChannel | undefined;

beforeEach(() => {
  // Bun/node MessageChannel exists in recent versions; make explicit.
  prevMC = (globalThis as { MessageChannel?: typeof MessageChannel }).MessageChannel;
});

afterEach(() => {
  (globalThis as { MessageChannel?: typeof MessageChannel }).MessageChannel = prevMC;
});

async function tick(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

describe("IframeChannel", () => {
  test("first attach() does the handshake and flushes buffered messages", async () => {
    const iframe = new FakeIframe();
    const seen: ParentMessage[] = [];
    const channel = new IframeChannel(iframe as unknown as HTMLIFrameElement, {});
    // Buffer a message before attach.
    channel.send({ type: "applyHover", path: "0.1" });

    channel.attach();
    expect(iframe.contentWindow.posted).toHaveLength(1);
    // Child runtime echoes via the port (simulated).
    iframe.contentWindow.posted[0]?.port.addEventListener("message", (e) => {
      seen.push((e as MessageEvent).data as ParentMessage);
    });
    iframe.contentWindow.posted[0]?.port.start();

    iframe.contentWindow.reply({ type: "ready" });
    await tick();
    // The buffered message should have been flushed.
    expect(seen).toEqual([{ type: "applyHover", path: "0.1" }]);
    channel.destroy();
  });

  test("second attach() after iframe reload starts a fresh handshake", async () => {
    const iframe = new FakeIframe();
    const channel = new IframeChannel(iframe as unknown as HTMLIFrameElement, {});

    // First handshake.
    channel.attach();
    iframe.contentWindow.reply({ type: "ready" });
    await tick();
    expect(iframe.contentWindow.posted).toHaveLength(1);

    // Simulate iframe reload: the channel doesn't know about the
    // reload, but the canvas re-fires `attach()` on the load event.
    channel.attach();
    // A new init should have been posted with fresh ports.
    expect(iframe.contentWindow.posted).toHaveLength(2);
    expect(iframe.contentWindow.posted[0]?.port).not.toBe(iframe.contentWindow.posted[1]?.port);
    channel.destroy();
  });

  test("messages buffered between attach() and ready survive the wait", async () => {
    const iframe = new FakeIframe();
    const seen: ParentMessage[] = [];
    const channel = new IframeChannel(iframe as unknown as HTMLIFrameElement, {});

    channel.attach();
    iframe.contentWindow.posted[0]?.port.addEventListener("message", (e) => {
      seen.push((e as MessageEvent).data as ParentMessage);
    });
    iframe.contentWindow.posted[0]?.port.start();

    // Parent sends before child says ready.
    channel.send({ type: "applyHighlight", path: "0" });
    channel.send({ type: "clearHover" });

    iframe.contentWindow.reply({ type: "ready" });
    await tick();

    expect(seen).toEqual([
      { type: "applyHighlight", path: "0" },
      { type: "clearHover" },
    ]);
    channel.destroy();
  });

  test("destroy() prevents further sends and retries", () => {
    const iframe = new FakeIframe();
    const channel = new IframeChannel(iframe as unknown as HTMLIFrameElement, {});
    channel.attach();
    channel.destroy();
    const beforeCount = iframe.contentWindow.posted.length;
    channel.attach(); // no-op after destroy
    expect(iframe.contentWindow.posted.length).toBe(beforeCount);
  });

  test("child messages route to handlers", async () => {
    const iframe = new FakeIframe();
    const rectsSeen: NodeRect[][] = [];
    const channel = new IframeChannel(iframe as unknown as HTMLIFrameElement, {
      onSelect(path) {
        rectsSeen.push([{ path: path ?? "(null)", x: 0, y: 0, w: 0, h: 0 }]);
      },
    });
    channel.attach();
    iframe.contentWindow.reply({ type: "ready" });
    iframe.contentWindow.reply({ type: "select", path: "1.2" });
    await tick();
    expect(rectsSeen.at(-1)?.[0]?.path).toBe("1.2");
    channel.destroy();
  });
});
