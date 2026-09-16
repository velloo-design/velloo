import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type {
  JSONRPCError,
  JSONRPCMessage,
  JSONRPCRequest,
  JSONRPCResultResponse,
} from "@modelcontextprotocol/sdk/types.js";
import { isJSONRPCRequest, isJSONRPCResponse } from "@modelcontextprotocol/sdk/types.js";
import { SWITCH_DESIGN_META, type SwitchDesignDirective } from "./designs.ts";

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
  /**
   * Bring up (or find) the daemon for another design and return its MCP URL —
   * what a `switch_design` result asks for. Once it succeeds, `rediscover`
   * must find *that* design's daemon: the session now belongs to it. Absent ⇒
   * a switch directive is refused.
   */
  switchTo?: ((root: string) => Promise<{ url: string } | { error: string }>) | undefined;
  /** Fires when either side closes (agent disconnects, daemon drops). */
  onExit?: (() => void) | undefined;
  /**
   * The agent-facing transport. Defaults to real stdio, which is what `velloo
   * mcp` runs on; tests substitute an in-memory pair so the reconnect path can
   * be driven without a subprocess.
   */
  agentTransport?: Transport | undefined;
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
  const stdio = opts.agentTransport ?? new StdioServerTransport();

  let closing = false;
  // The agent's initialize request, replayed onto a fresh daemon on reconnect.
  let initRequest: JSONRPCRequest | null = null;
  // Ids of replayed initializes — their responses answer nobody on stdio.
  const reinitIds = new Set<string>();
  let reinitSeq = 0;
  // What a replayed initialize answered, for a switch that hands the agent the
  // new design's instructions.
  const reinitResults = new Map<string, JSONRPCResultResponse["result"]>();
  let reconnecting: Promise<boolean> | null = null;
  // While a switch rebinds the session, agent messages wait so none of them
  // lands on the design being left.
  let switching: Promise<void> | null = null;
  const held: JSONRPCMessage[] = [];

  const wire = (transport: StreamableHTTPClientTransport): StreamableHTTPClientTransport => {
    transport.onmessage = (msg) => {
      if (isJSONRPCResponse(msg) && typeof msg.id === "string" && reinitIds.has(msg.id)) {
        reinitIds.delete(msg.id);
        reinitResults.set(msg.id, msg.result);
        return;
      }
      const directive = isJSONRPCResponse(msg) ? switchDirective(msg) : null;
      if (directive && isJSONRPCResponse(msg)) {
        performSwitch(msg, directive);
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
   * Build a transport onto `url` and establish a session on it, then swap it
   * in. `replayInit` is false when the failed message is itself the initialize
   * — re-sending it after a replay would double-initialize. Resolves to the
   * replayed initialize's result (null when none was replayed), or false.
   */
  const bind = async (
    url: string,
    replayInit: boolean,
  ): Promise<JSONRPCResultResponse["result"] | null | false> => {
    const next = wire(new StreamableHTTPClientTransport(new URL(url)));
    let initResult: JSONRPCResultResponse["result"] | null = null;
    try {
      await next.start();
      if (replayInit && initRequest) {
        const reinitId = `velloo-reinit-${++reinitSeq}`;
        reinitIds.add(reinitId);
        await next.send({ ...initRequest, id: reinitId });
        initResult = reinitResults.get(reinitId) ?? null;
        reinitResults.delete(reinitId);
        await next.send({ jsonrpc: "2.0", method: "notifications/initialized" });
      }
    } catch (err) {
      console.error("velloo mcp: connecting to the canvas daemon failed:", err);
      await next.close().catch(() => undefined);
      return false;
    }
    const prev = http;
    http = next; // swap before closing so prev.onclose sees it's not active
    // End the old session explicitly, so a daemon this session left can count
    // it gone and idle out; a crashed one simply fails to answer.
    await prev.terminateSession().catch(() => undefined);
    await prev.close().catch(() => undefined);
    return initResult;
  };

  const reconnect = async (replayInit: boolean): Promise<boolean> => {
    if (!opts.rediscover) return false;
    const url = await opts.rediscover().catch(() => null);
    if (!url || closing) return false;
    if ((await bind(url, replayInit)) === false) return false;
    console.error(`velloo mcp: reconnected to the canvas daemon at ${url}`);
    return true;
  };

  /**
   * Carry the session to another design's daemon. The `switch_design` response
   * that asked for it is held, then answered here: with the new design's
   * instructions on success, or an error that leaves the session where it was.
   */
  const performSwitch = (response: JSONRPCResultResponse, directive: SwitchDesignDirective) => {
    const run = async () => {
      const reply = (result: Record<string, unknown>) =>
        stdio.send({ jsonrpc: "2.0", id: response.id, result }).catch(() => undefined);
      const failed = (message: string) =>
        reply({
          isError: true,
          content: [
            {
              type: "text",
              text: JSON.stringify({ kind: "DesignSwitchFailed", name: directive.name, message }),
            },
          ],
        });
      if (!opts.switchTo) {
        await failed("this connection can't move to another design");
        return;
      }
      const target = await opts
        .switchTo(directive.root)
        .catch((err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }));
      if ("error" in target) {
        await failed(target.error);
        return;
      }
      const init = await bind(target.url, true);
      if (init === false) {
        await failed(`the canvas daemon for "${directive.name}" did not accept the session`);
        return;
      }
      const instructions = (init as { instructions?: unknown } | null)?.instructions;
      await reply({
        content: [
          { type: "text", text: JSON.stringify({ kind: "DesignSwitched", name: directive.name }) },
          ...(typeof instructions === "string" ? [{ type: "text", text: instructions }] : []),
        ],
      });
      await stdio
        .send({ jsonrpc: "2.0", method: "notifications/tools/list_changed" })
        .catch(() => undefined);
      console.error(`velloo mcp: switched to design "${directive.name}" at ${target.url}`);
    };
    switching = run().finally(() => {
      switching = null;
      for (const msg of held.splice(0)) void forward(msg);
    });
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

  stdio.onmessage = (msg: JSONRPCMessage) => {
    if (isJSONRPCRequest(msg) && msg.method === "initialize") initRequest = msg;
    if (switching) {
      held.push(msg);
      return;
    }
    void forward(msg);
  };
  stdio.onclose = () => void close();

  // Connect the client first so we're ready before stdin delivers `initialize`.
  await http.start();
  await stdio.start();
  return { close };
}

function switchDirective(response: JSONRPCResultResponse): SwitchDesignDirective | null {
  const meta = (response.result as { _meta?: Record<string, unknown> } | undefined)?._meta;
  const directive = meta?.[SWITCH_DESIGN_META] as Partial<SwitchDesignDirective> | undefined;
  return typeof directive?.name === "string" && typeof directive.root === "string"
    ? { name: directive.name, root: directive.root }
    : null;
}
