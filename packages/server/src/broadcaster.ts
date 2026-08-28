import type { ServerWebSocket } from "bun";
import type { ActivityEvent } from "./activity.ts";
import type { WatchEvent } from "./watcher.ts";

/**
 * Tracks live WebSocket clients and pushes file-watch events to all of them.
 * Bun's native WS support is the simplest path here; we don't need Hono's
 * upgrade helper.
 */
export class Broadcaster {
  private clients = new Set<ServerWebSocket<unknown>>();

  register(ws: ServerWebSocket<unknown>): void {
    this.clients.add(ws);
  }

  unregister(ws: ServerWebSocket<unknown>): void {
    this.clients.delete(ws);
  }

  broadcast(event: WatchEvent | ActivityEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.clients) {
      try {
        ws.send(payload);
      } catch {
        // Client gone; will get cleaned up on close.
      }
    }
  }

  size(): number {
    return this.clients.size;
  }
}
