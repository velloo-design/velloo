import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Where a CLI agent is usually installed, beyond the daemon's own PATH. A
 * daemon started from a GUI or a login shell that skipped the user's profile
 * has a short PATH, and a person who can run `codex` in their terminal would
 * otherwise be told it isn't installed.
 */
const EXTRA_BIN_DIRS = [
  join(homedir(), ".local", "bin"),
  join(homedir(), ".bun", "bin"),
  join(homedir(), ".npm-global", "bin"),
  join(homedir(), ".claude", "local"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
];

/** The PATH a provider process runs with: the daemon's, plus the usual install dirs. */
function agentPath(): string {
  const own = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return [...own, ...EXTRA_BIN_DIRS.filter((dir) => !own.includes(dir))].join(delimiter);
}

/** Find an executable the way the person's shell would, plus the usual install dirs. */
export function findExecutable(name: string): string | null {
  return Bun.which(name, { PATH: agentPath() });
}

/**
 * Run a short command and return its stdout, or null when it fails or takes too
 * long. `anyExit` keeps the stdout of a non-zero exit, for status commands that
 * report a negative answer through their exit code (`claude auth status` exits
 * 1 when signed out).
 */
export async function runOnce(
  cmd: string[],
  cwd?: string,
  timeoutMs = 10_000,
  { anyExit = false }: { anyExit?: boolean } = {},
): Promise<string | null> {
  try {
    const proc = Bun.spawn(cmd, {
      ...(cwd ? { cwd } : {}),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: agentPath() },
      timeout: timeoutMs,
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return code === 0 || (anyExit && code !== null && out) ? out : null;
  } catch {
    return null;
  }
}

/** The first `x.y.z` in a `--version` line. */
export function parseVersion(text: string | null): string | null {
  return text?.match(/(\d+)\.(\d+)\.(\d+)/)?.[0] ?? null;
}

export interface JsonLineProcessHandlers {
  message(value: unknown): void;
  /** A line that wasn't JSON. Providers print the odd log line; most are ignored. */
  malformed(line: string): void;
  exit(code: number | null, stderrTail: string): void;
}

const STDERR_TAIL = 4_000;
/** Process groups are a POSIX idea; on Windows only the agent itself is stopped. */
const GROUPS = process.platform !== "win32";

/**
 * A child process that speaks one JSON value per line on stdin and stdout —
 * the transport both Codex's app-server and Claude Code's stream-json mode
 * use. Owns the read loop, keeps the tail of stderr for diagnostics, and stops
 * the process gently, then firmly.
 */
export class JsonLineProcess {
  private readonly proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private stderr = "";
  private closed = false;
  readonly exited: Promise<number | null>;

  constructor(cmd: string[], cwd: string, handlers: JsonLineProcessHandlers) {
    this.proc = Bun.spawn(cmd, {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, PATH: agentPath() },
      // Its own process group, so closing it reaches the commands and MCP
      // servers it started too, not only the agent.
      detached: GROUPS,
    });
    void this.read(handlers);
    void this.readStderr();
    this.exited = this.proc.exited.then(
      async (code) => {
        // Let the last stdout lines drain before reporting the exit.
        await Bun.sleep(20);
        handlers.exit(this.closed ? 0 : code, this.stderr.trim());
        return code;
      },
      () => null,
    );
  }

  get pid(): number {
    return this.proc.pid;
  }

  write(value: unknown): void {
    if (this.closed) return;
    try {
      this.proc.stdin.write(`${JSON.stringify(value)}\n`);
      void this.proc.stdin.flush();
    } catch {
      // The process is gone; its exit is reported by `exited`.
    }
  }

  /** Ask it to stop (end of input, then SIGTERM), and kill it if it doesn't. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      void this.proc.stdin.end();
    } catch {
      // Already closed.
    }
    this.signal("SIGTERM");
    await Promise.race([this.exited, Bun.sleep(3_000)]);
    // Whatever is still running — the agent, or a command it left behind.
    this.signal("SIGKILL");
  }

  private signal(signal: NodeJS.Signals): void {
    try {
      if (GROUPS) process.kill(-this.proc.pid, signal);
      else this.proc.kill(signal);
    } catch {
      // Nothing left in the group.
    }
  }

  private async read(handlers: JsonLineProcessHandlers): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of this.proc.stdout) {
        buffer += decoder.decode(chunk, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line) continue;
          let value: unknown;
          try {
            value = JSON.parse(line);
          } catch {
            handlers.malformed(line);
            continue;
          }
          try {
            handlers.message(value);
          } catch (error) {
            console.error("velloo: an agent message couldn't be handled:", error);
          }
        }
      }
    } catch {
      // The stream ends with the process.
    }
  }

  private async readStderr(): Promise<void> {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of this.proc.stderr) {
        this.stderr += decoder.decode(chunk, { stream: true });
        if (this.stderr.length > STDERR_TAIL * 2) this.stderr = this.stderr.slice(-STDERR_TAIL);
      }
    } catch {
      // The stream ends with the process.
    }
  }
}
