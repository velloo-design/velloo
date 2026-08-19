import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

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
      void close();
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
