import { confirm, isCancel } from "@clack/prompts";
import {
  BrowserMissingError,
  CHROMIUM_DEPS_INSTALL_ARGV,
  CHROMIUM_DEPS_INSTALL_CMD,
  CHROMIUM_INSTALL_ARGV,
  CHROMIUM_INSTALL_CMD,
} from "@velloo/renderer";
import pc from "picocolors";
import { fail } from "./fail.ts";

/** One-line prompt subtext shared by every "install the browser?" question. */
export const BROWSER_PROMPT_DETAIL = pc.dim(
  "Headless Chromium — powers the agent's screenshot tool, velloo render --to=png, and PNG/PDF export. The canvas itself never needs it.",
);

export const BROWSER_PROMPT_SIZE = "(~110MB, one-time)";

interface ChromiumInstallResult {
  ok: boolean;
  /**
   * Linux: the download finished but playwright's host validation reported
   * missing shared libraries (its "Host system is missing dependencies" box).
   * The installer still exits 0 in that state, so exit-code checks alone
   * would report a browser that can't actually launch.
   */
  missingSystemLibs: boolean;
}

/**
 * Run the pinned browser install, streaming its output through while watching
 * for the host-validation warning. Callers must treat `missingSystemLibs` as
 * not-installed for readiness purposes.
 */
async function runChromiumInstall(): Promise<ChromiumInstallResult> {
  const proc = Bun.spawn([...CHROMIUM_INSTALL_ARGV], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
  });
  let captured = "";
  const pump = async (
    stream: ReadableStream<Uint8Array>,
    out: { write(c: Uint8Array): unknown },
  ) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      out.write(chunk);
      captured += decoder.decode(chunk, { stream: true });
    }
  };
  const [, , code] = await Promise.all([
    pump(proc.stdout, process.stdout),
    pump(proc.stderr, process.stderr),
    proc.exited,
  ]);
  const missingSystemLibs = /missing dependencies to run browsers|Missing libraries:/i.test(
    captured,
  );
  return { ok: code === 0 && !missingSystemLibs, missingSystemLibs };
}

/**
 * Interactive install: download the browser, and when the Linux host lacks
 * the shared libraries Chromium needs, offer to install them via playwright's
 * `install-deps` (distro package manager; needs root/sudo). Returns true only
 * when screenshots are actually usable.
 */
export async function installChromiumInteractive(): Promise<boolean> {
  const result = await runChromiumInstall();
  if (result.ok) return true;
  if (!result.missingSystemLibs) return false;

  console.log("");
  console.log(
    `  ${pc.yellow("⚠")} Browser downloaded, but your system is missing libraries it needs to run.`,
  );
  const proceed = await confirm({
    message: `Install the missing system libraries now? ${pc.dim(`(${CHROMIUM_DEPS_INSTALL_CMD} — uses your distro's package manager, needs root/sudo)`)}`,
    initialValue: true,
  });
  if (isCancel(proceed) || !proceed) {
    console.log(pc.dim(`  Install them later with: ${pc.cyan(CHROMIUM_DEPS_INSTALL_CMD)}`));
    return false;
  }
  const code = await Bun.spawn([...CHROMIUM_DEPS_INSTALL_ARGV], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }).exited;
  if (code !== 0) {
    console.log(
      pc.dim(
        `  That didn't finish — run it manually: ${pc.cyan(`sudo ${CHROMIUM_DEPS_INSTALL_CMD}`)}`,
      ),
    );
    return false;
  }
  return true;
}

/**
 * Run a capture; if the headless browser is missing, offer to install it
 * (interactive shells only) and retry once. Non-interactive shells get the
 * actionable hint and a non-zero exit so CI fails loudly rather than hanging
 * on a prompt. Shared by `velloo render` and `velloo export` so both surface
 * the missing-Chromium hint identically.
 */
export async function captureWithBrowserSetup(
  cmd: string,
  capture: () => Promise<unknown>,
): Promise<void> {
  try {
    await capture();
    return;
  } catch (e) {
    if (!(e instanceof BrowserMissingError)) throw e;
    if (!process.stdin.isTTY) fail(cmd, e.message);
    const proceed = await confirm({
      message: `Chromium isn't installed — \`${CHROMIUM_INSTALL_CMD}\` now? ${BROWSER_PROMPT_SIZE}\n${BROWSER_PROMPT_DETAIL}`,
      initialValue: true,
    });
    if (isCancel(proceed) || !proceed) fail(cmd, e.message);
    if (!(await installChromiumInteractive())) {
      fail(cmd, "the browser isn't usable yet — see the output above.");
    }
  }
  await capture();
}
