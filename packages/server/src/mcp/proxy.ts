import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { JSONRPCError } from "@modelcontextprotocol/sdk/types.js";
import { isJSONRPCRequest } from "@modelcontextprotocol/sdk/types.js";

export interface StdioMcpProxyHandle {
  close(): Promise<void>;
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
 * tears down the whole session. Previously any one failed `http.send` closed the
 * proxy, so a stressed render dropped every tool at once. A genuine transport
 * close (daemon stopped/crashed) still ends the proxy; the agent then reconnects
 * with a fresh `velloo mcp`.
 *
 * `onExit` fires when either side closes (agent disconnects, or the daemon
 * drops the connection) so the caller can terminate the proxy process.
 */
export async function runStdioMcpProxy(
  httpMcpUrl: string,
  onExit?: () => void,
): Promise<StdioMcpProxyHandle> {
  const stdio = new StdioServerTransport();
  const http = new StreamableHTTPClientTransport(new URL(httpMcpUrl));

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await stdio.close().catch(() => undefined);
    await http.close().catch(() => undefined);
    onExit?.();
  };

  stdio.onmessage = (msg) => {
    void http.send(msg).catch((err) => {
      console.error("velloo mcp: forwarding to canvas daemon failed:", err);
      // Per-request isolation: fail just this call so the agent can retry,
      // instead of closing the whole session. Notifications and responses have
      // nothing to answer, so they're only logged.
      if (isJSONRPCRequest(msg)) {
        const reply: JSONRPCError = {
          jsonrpc: "2.0",
          id: msg.id,
          error: {
            code: -32000,
            message: `velloo: forwarding to the canvas daemon failed (${
              err instanceof Error ? err.message : String(err)
            }) — retry`,
          },
        };
        void stdio.send(reply).catch(() => undefined);
      }
    });
  };
  http.onmessage = (msg) => {
    void stdio.send(msg).catch(() => undefined);
  };
  stdio.onclose = () => void close();
  http.onclose = () => void close();
  http.onerror = (err) => console.error("velloo mcp: canvas daemon connection error:", err);

  // Connect the client first so we're ready before stdin delivers `initialize`.
  await http.start();
  await stdio.start();
  return { close };
}
