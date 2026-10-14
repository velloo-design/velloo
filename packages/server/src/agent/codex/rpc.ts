/**
 * JSON-RPC over the app-server's stdio: requests we send and the responses
 * they wait on, plus the notifications and server→client requests Codex sends.
 * Codex omits the `jsonrpc` member on the wire, so nothing here requires it.
 */

export type RpcId = string | number;

export type RpcIncoming =
  | { kind: "notification"; method: string; params: Record<string, unknown> }
  | { kind: "request"; id: RpcId; method: string; params: Record<string, unknown> }
  | { kind: "response" };

class RpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}

/** Codex's "server overloaded; retry later" error. */
const OVERLOADED = -32001;
const RETRIES = [250, 750, 2000];

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export class CodexRpc {
  private nextId = 1;
  private readonly pending = new Map<RpcId, Pending>();

  constructor(private readonly send: (value: unknown) => void) {}

  /** Send a request, retrying while Codex says it is overloaded. */
  async request<T = Record<string, unknown>>(
    method: string,
    params: unknown,
    timeoutMs = 60_000,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await this.once(method, params, timeoutMs)) as T;
      } catch (error) {
        const delay = RETRIES[attempt];
        if (!(error instanceof RpcError) || error.code !== OVERLOADED || delay === undefined)
          throw error;
        await Bun.sleep(delay);
      }
    }
  }

  notify(method: string, params?: unknown): void {
    this.send(params === undefined ? { method } : { method, params });
  }

  respond(id: RpcId, result: unknown): void {
    this.send({ id, result });
  }

  respondError(id: RpcId, code: number, message: string): void {
    this.send({ id, error: { code, message } });
  }

  /** Route one incoming value: settle a pending request, or hand back what it is. */
  handle(raw: unknown): RpcIncoming | null {
    const msg = asRecord(raw);
    const id = msg.id;
    const method = typeof msg.method === "string" ? msg.method : undefined;
    const validId = typeof id === "string" || typeof id === "number";
    if (method && validId) return { kind: "request", id, method, params: asRecord(msg.params) };
    if (method) return { kind: "notification", method, params: asRecord(msg.params) };
    if (!validId) return null;
    const pending = this.pending.get(id);
    if (!pending) return { kind: "response" };
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (msg.error !== undefined) {
      const error = asRecord(msg.error);
      pending.reject(
        new RpcError(
          typeof error.code === "number" ? error.code : -32603,
          typeof error.message === "string" ? error.message : "Codex returned an error.",
        ),
      );
    } else pending.resolve(msg.result);
    return { kind: "response" };
  }

  /** Fail every request still waiting, when the process is gone. */
  failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private once(method: string, params: unknown, timeoutMs: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError(-32000, `Codex didn't answer ${method} in time.`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
}
