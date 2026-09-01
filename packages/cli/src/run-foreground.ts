/**
 * Foreground attach for `velloo run`: stay in the terminal with single-key
 * shortcuts until the user backgrounds, stops, or the daemon exits.
 *
 * Keys are lowercase-only. Arrow-key CSI sequences can arrive split, and a
 * trailing `B` (down) must not mean "background".
 */

/** ETX — raw mode delivers Ctrl-C as a keystroke, not a signal. */
const CTRL_C = "\u0003";

export type RunKeyAction = "background" | "stop" | "open";

export type ForegroundOutcome = "background" | "stop" | "died";

export function actionForRunKey(key: string): RunKeyAction | null {
  if (key === "b") return "background";
  if (key === "s" || key === CTRL_C) return "stop";
  if (key === "o") return "open";
  return null;
}

export function shouldStayForeground(opts: { background: boolean; stdinIsTTY: boolean }): boolean {
  return !opts.background && opts.stdinIsTTY;
}

function bindRunKeys(onKey: (key: string) => void): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return () => {};
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  const onData = (chunk: string): void => {
    onKey(chunk);
  };
  stdin.on("data", onData);
  return () => {
    stdin.off("data", onData);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  };
}

const LIVE_POLL_MS = 2000;

/**
 * Block until the user backgrounds or stops, or the daemon disappears.
 * `onOpen` is the repeatable action (open the browser) and does not settle.
 */
export async function waitInForeground(opts: {
  isLive: () => Promise<boolean>;
  onOpen: () => void;
}): Promise<ForegroundOutcome> {
  return await new Promise((resolve) => {
    let settled = false;
    let unbind = () => {};
    let timer: ReturnType<typeof setInterval> | undefined;
    const finish = (outcome: ForegroundOutcome) => {
      if (settled) return;
      settled = true;
      unbind();
      if (timer !== undefined) clearInterval(timer);
      process.off("SIGINT", onStop);
      process.off("SIGTERM", onStop);
      resolve(outcome);
    };
    const onStop = () => finish("stop");
    unbind = bindRunKeys((key) => {
      const action = actionForRunKey(key);
      if (action === "open") opts.onOpen();
      else if (action === "background" || action === "stop") finish(action);
    });
    process.on("SIGINT", onStop);
    process.on("SIGTERM", onStop);
    timer = setInterval(() => {
      void opts.isLive().then((live) => {
        if (!live) finish("died");
      });
    }, LIVE_POLL_MS);
  });
}
