import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type {
  JSONRPCError,
  JSONRPCMessage,
  JSONRPCRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { isJSONRPCRequest, isJSONRPCResponse } from "@modelcontextprotocol/sdk/types.js";

export interface StdioMcpProxyHandle {
  close(): Promise<void>;
}

export interface StdioMcpProxyOptions {
  /**
   * Re-resolve the daemon's MCP URL after a forward failure — typically by
   * re-reading the runtime lockfile and respawning the daemon if it died.
   * Return null when no live daemon could be found or brought up.
   */
  rediscover?: (() => Promise<string | null>) | undefined;
  /** Fires when either side closes (agent disconnects, daemon drops). */
  onExit?: (() => void) | undefined;
}

/**
 * Bridge the agent's stdio MCP connection to the shared canvas daemon's HTTP
 * MCP endpoint. The agent spawns `velloo mcp`; this pipes its stdin/stdout
 * JSON-RPC to the daemon over HTTP and back, so every agent for a folder
 * drives the *same* daemon (one writer, one canvas) instead of booting its
 * own. It's a transport-level relay — no per-method logic — and the daemon
 * assigns each proxy its own MCP session.
 *
 * A single failed forward to the daemon (a slow/heavy `screenshot`, a transient
 * transport hiccup) errors only *that* request back to the agent — it no longer
 * tears down the whole session.
 *
 * The daemon's MCP port is ephemeral (bound to port 0), so a crashed daemon
 * respawns somewhere else and the transport built at proxy startup can never
 * reach it again — retrying against the cached URL fails forever. On a forward
 * failure the proxy therefore re-discovers the daemon via `rediscover` (which
 * may spawn a fresh one), rebuilds the HTTP transport, replays the agent's
 * `initialize` to establish a session on the new daemon (the crashed one lost
 * all session state anyway), and re-sends the failed message — the agent's
 * stdio session survives the daemon restart. Only if re-discovery itself fails
 * does the request error back to the agent.
 *
 * `onExit` fires when either side closes (agent disconnects, or the daemon
 * drops the connection) so the caller can terminate the proxy process.
 */
export async function runStdioMcpProxy(
  httpMcpUrl: string,
  opts: StdioMcpProxyOptions = {},
): Promise<StdioMcpProxyHandle> {
  const stdio = new StdioServerTransport();

  let closing = false;
  // The agent's initialize request, replayed onto a fresh daemon on reconnect.
  let initRequest: JSONRPCRequest | null = null;
  // Ids of replayed initializes — their responses answer nobody on stdio.
  const reinitIds = new Set<string>();
  let reinitSeq = 0;
  let reconnecting: Promise<boolean> | null = null;

  const wire = (transport: StreamableHTTPClientTransport): StreamableHTTPClientTransport => {
    transport.onmessage = (msg) => {
      if (isJSONRPCResponse(msg) && typeof msg.id === "string" && reinitIds.has(msg.id)) {
        reinitIds.delete(msg.id);
        return;
      }
      void stdio.send(msg).catch(() => undefined);
    };
    // Only the *active* transport closing ends the proxy — a transport we
    // swapped out during reconnect closes as part of the swap.
    transport.onclose = () => {
      if (transport === http) void close();
    };
    transport.onerror = (err) => console.error("velloo mcp: canvas daemon connection error:", err);
    return transport;
  };

  let http = wire(new StreamableHTTPClientTransport(new URL(httpMcpUrl)));

  const close = async () => {
    if (closing) return;
    closing = true;
    await stdio.close().catch(() => undefined);
    await http.close().catch(() => undefined);
    opts.onExit?.();
  };

  /**
   * Build a transport onto a freshly discovered daemon and establish a session
   * on it. `replayInit` is false when the failed message is itself the
   * initialize — re-sending it after a replay would double-initialize.
   */
  const reconnect = async (replayInit: boolean): Promise<boolean> => {
    if (!opts.rediscover) return false;
    const url = await opts.rediscover().catch(() => null);
    if (!url || closing) return false;
    const next = wire(new StreamableHTTPClientTransport(new URL(url)));
    try {
      await next.start();
      if (replayInit && initRequest) {
        const reinitId = `velloo-reinit-${++reinitSeq}`;
        reinitIds.add(reinitId);
        await next.send({ ...initRequest, id: reinitId });
        await next.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      }
    } catch (err) {
      console.error("velloo mcp: reconnect to respawned canvas daemon failed:", err);
      await next.close().catch(() => undefined);
      return false;
    }
    const prev = http;
    http = next; // swap before closing so prev.onclose sees it's not active
    await prev.close().catch(() => undefined);
    console.error(`velloo mcp: reconnected to the canvas daemon at ${url}`);
    return true;
  };

  const reconnectOnce = (replayInit: boolean): Promise<boolean> => {
    reconnecting ??= reconnect(replayInit).finally(() => {
      reconnecting = null;
    });
    return reconnecting;
  };

  const forward = async (msg: JSONRPCMessage): Promise<void> => {
    let error: unknown;
    try {
      await http.send(msg);
      return;
    } catch (err) {
      error = err;
    }
    console.error("velloo mcp: forwarding to canvas daemon failed:", error);
    const isInit = isJSONRPCRequest(msg) && msg.method === "initialize";
    if (await reconnectOnce(!isInit)) {
      try {
        await http.send(msg);
        return;
      } catch (err) {
        error = err;
      }
    }
    // Per-request isolation: fail just this call instead of closing the whole
    // session. Notifications and responses have nothing to answer — log only.
    if (isJSONRPCRequest(msg)) {
      const detail = error instanceof Error ? error.message : String(error);
      const reply: JSONRPCError = {
        jsonrpc: "2.0",
        id: msg.id,
        error: {
          code: -32000,
          message: opts.rediscover
            ? `velloo: the canvas daemon is unreachable and could not be respawned (${detail}) — check .design/cache/daemon.log, then retry`
            : `velloo: forwarding to the canvas daemon failed (${detail}) — retry`,
        },
      };
      void stdio.send(reply).catch(() => undefined);
    }
  };

  stdio.onmessage = (msg) => {
    if (isJSONRPCRequest(msg) && msg.method === "initialize") initRequest = msg;
    void forward(msg);
  };
  stdio.onclose = () => void close();

  // Connect the client first so we're ready before stdin delivers `initialize`.
  await http.start();
  await stdio.start();
  return { close };
}
