import { join } from "node:path";
import { confirm, isCancel, select } from "@clack/prompts";
import {
  type CaptureManifest,
  captureDir,
  capturesDir,
  deleteCapture,
  HeadedBrowserMissingError,
  isSafeCaptureId,
  listCaptures,
  sessionStatePath,
  startCaptureSession,
} from "@velloo/renderer";
import { loadDesignFolder } from "@velloo/server";
import { defineCommand } from "citty";
import pc from "picocolors";
import { installChromiumInteractive } from "../browser-setup.ts";
import { fail } from "../fail.ts";
import { FOLDER_ARG_DESCRIPTION, resolveDesignFolder } from "../folder.ts";
import { openUrl } from "../open-url.ts";

/** ETX — raw mode delivers Ctrl-C as a keystroke, not a signal. */
const CTRL_C = 3;

/** Hosts that mean "the dev server on this machine", which is never https. */
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i;

/**
 * Accept what someone would actually type. `kiro.dev` and `localhost:3000` are
 * URLs to a human, so a bare host gets a scheme rather than an error — https
 * normally, http for loopback (where there's no certificate to speak of).
 *
 * Deliberately CLI-only: an agent calling `start_capture_session` should pass a
 * real URL, and guessing a scheme on its behalf would hide a genuine mistake.
 *
 * Returns null when there's no usable http(s) URL in the input.
 */
export function normalizeCaptureUrl(input: string): string | null {
  const raw = input.trim();
  if (raw === "") return null;
  // `localhost:3000` parses as a URL whose *protocol* is "localhost:", so the
  // scheme has to be detected by shape rather than by attempting a parse.
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  const host = raw.split(/[/?#]/, 1)[0] ?? "";
  const candidate = hasScheme ? raw : `${LOOPBACK.test(host) ? "http" : "https"}://${raw}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.hostname === "") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Raw-mode keystrokes that mirror the in-page toolbar.
 *
 * The toolbar is the primary surface — the user is in the browser, not the
 * terminal — but a user who *is* at the shell shouldn't have to reach for the
 * mouse. Returns a teardown that restores the terminal.
 */
function bindKeys(handlers: {
  page: () => void;
  theme: () => void;
  list: () => void;
  quit: () => void;
}): () => void {
  const stdin = process.stdin;
  if (!stdin.isTTY) return () => {};
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  const onData = (key: string): void => {
    // Raw mode suppresses the default SIGINT, so Ctrl-C has to end the session
    // explicitly — otherwise the browser would outlive the command.
    if (key === "c") handlers.page();
    else if (key === "t") handlers.theme();
    else if (key === "l") handlers.list();
    else if (key === "q" || key.charCodeAt(0) === CTRL_C) handlers.quit();
  };
  stdin.on("data", onData);
  return () => {
    stdin.off("data", onData);
    if (stdin.isTTY) stdin.setRawMode(false);
    stdin.pause();
  };
}

/** `2026-08-12T16:09:03.320Z` → `Aug 12 16:09`. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function describe(m: CaptureManifest): string {
  const what = m.themeOnly ? "theme only" : `${m.nodeCount} nodes, ${m.assetCount} assets`;
  return `${m.title || m.finalUrl || m.url} ${pc.dim(`— ${what}, ${when(m.capturedAt)}`)}`;
}

function printCaptures(captures: CaptureManifest[], dir: string): void {
  console.log("");
  if (captures.length === 0) {
    console.log(pc.dim("  No captures yet. Run `velloo capture <url>` to make one."));
    console.log("");
    return;
  }
  console.log(`  ${pc.bold(`${captures.length} capture${captures.length === 1 ? "" : "s"}`)}`);
  console.log(pc.dim(`  ${dir}`));
  console.log("");
  for (const m of captures) {
    console.log(`  ${pc.cyan(m.id)}  ${describe(m)}`);
    console.log(pc.dim(`    ${m.finalUrl || m.url}`));
  }
  console.log("");
}

/**
 * Browse what has been captured, and clear what isn't wanted. Captures hold
 * real content from the user's app, so being able to look through them and
 * delete them is part of the feature rather than a nicety.
 */
async function browseCaptures(root: string, folderId: string | undefined): Promise<void> {
  const dir = capturesDir(root, folderId);
  let captures = listCaptures(root, folderId);
  if (!process.stdin.isTTY || captures.length === 0) {
    printCaptures(captures, dir);
    return;
  }

  for (;;) {
    captures = listCaptures(root, folderId);
    if (captures.length === 0) {
      console.log(pc.dim("\n  No captures left.\n"));
      return;
    }
    const picked = await select({
      message: `${captures.length} capture${captures.length === 1 ? "" : "s"} for this folder`,
      options: [
        ...captures.map((m) => ({ value: m.id, label: describe(m), hint: m.finalUrl || m.url })),
        { value: "__done", label: pc.dim("Done") },
      ],
    });
    if (isCancel(picked) || picked === "__done") return;

    const manifest = captures.find((m) => m.id === picked);
    if (!manifest) continue;
    const action = await select({
      message: manifest.title || manifest.id,
      options: [
        ...(manifest.files.includes("page.png")
          ? [{ value: "open", label: "Open the screenshot" }]
          : []),
        { value: "details", label: "Show what it contains" },
        { value: "delete", label: pc.red("Delete this capture") },
        { value: "back", label: pc.dim("Back") },
      ],
    });
    if (isCancel(action) || action === "back") continue;

    if (action === "open") {
      await openUrl(`file://${join(captureDir(root, manifest.id, folderId), "page.png")}`);
      continue;
    }
    if (action === "details") {
      console.log("");
      console.log(`  ${pc.bold(manifest.id)}`);
      console.log(`    url        ${manifest.finalUrl || manifest.url}`);
      console.log(`    captured   ${when(manifest.capturedAt)}`);
      console.log(`    viewport   ${manifest.viewport.w}×${manifest.viewport.h}`);
      console.log(`    nodes      ${manifest.nodeCount}`);
      console.log(`    assets     ${manifest.assetCount}`);
      console.log(`    files      ${manifest.files.join(", ")}`);
      console.log(pc.dim(`    ${captureDir(root, manifest.id, folderId)}`));
      console.log("");
      console.log(
        pc.dim(`    verify a screen against it: compare_to_url { captureId: "${manifest.id}" }`),
      );
      console.log("");
      continue;
    }
    if (action === "delete") {
      const sure = await confirm({
        message: `Delete ${manifest.title || manifest.id}? This can't be undone.`,
        initialValue: false,
      });
      if (isCancel(sure) || !sure) continue;
      deleteCapture(root, manifest.id, folderId);
      console.log(pc.dim(`  deleted ${manifest.id}`));
    }
  }
}

export default defineCommand({
  meta: {
    name: "capture",
    description: "open a browser, log in, and capture pages as evidence for the agent",
  },
  args: {
    url: {
      type: "positional",
      required: false,
      description: "Page to open the browser on, e.g. http://localhost:3000/dashboard",
    },
    folder: { type: "string", description: FOLDER_ARG_DESCRIPTION },
    list: {
      type: "boolean",
      default: false,
      description: "Browse stored captures instead of opening a browser (interactive on a TTY)",
    },
    delete: {
      type: "string",
      description: "Delete a capture by id, or `all` to clear every capture for this folder",
    },
  },
  async run({ args }) {
    const folder = await resolveDesignFolder(args.folder, "capture");
    const design = await loadDesignFolder(folder);
    const folderId = design.config.folderId;

    // Managing what's already stored never opens a browser.
    if (args.delete !== undefined) {
      const id = args.delete.trim();
      if (id === "all") {
        const all = listCaptures(design.root, folderId);
        if (all.length === 0) {
          console.log(pc.dim("velloo capture: no captures to delete."));
          return;
        }
        if (process.stdin.isTTY) {
          const sure = await confirm({
            message: `Delete all ${all.length} captures for this folder? This can't be undone.`,
            initialValue: false,
          });
          if (isCancel(sure) || !sure) {
            console.log(pc.dim("  nothing deleted."));
            return;
          }
        }
        for (const m of all) deleteCapture(design.root, m.id, folderId);
        console.log(`velloo capture: deleted ${all.length} captures.`);
        return;
      }
      if (!isSafeCaptureId(id)) fail("capture", `not a capture id: ${args.delete}`);
      if (!deleteCapture(design.root, id, folderId)) {
        fail("capture", `no capture "${id}" for this folder — run \`velloo capture --list\`.`);
      }
      console.log(`velloo capture: deleted ${id}.`);
      return;
    }

    if (args.list) {
      await browseCaptures(design.root, folderId);
      return;
    }

    let url: string | undefined;
    if (args.url !== undefined) {
      const normalized = normalizeCaptureUrl(args.url);
      if (normalized === null) {
        fail("capture", `not a page that can be captured: ${args.url} (expected an http(s) URL)`);
      }
      url = normalized;
    }

    const statePath = url
      ? sessionStatePath(design.root, new URL(url).origin, folderId)
      : undefined;

    console.log("");
    console.log(`  ${pc.bold("velloo capture")}`);
    console.log(
      pc.dim(
        "  A browser window opens. Log in and navigate wherever you need — then use the\n" +
          "  velloo toolbar in the page (or the keys below) to capture what the agent should see.",
      ),
    );
    console.log("");
    console.log(
      pc.dim(
        `  ${pc.cyan("c")} capture page   ${pc.cyan("t")} capture theme   ${pc.cyan("l")} list   ${pc.cyan("q")} done`,
      ),
    );
    console.log("");

    const made: CaptureManifest[] = [];
    const onCapture = (m: CaptureManifest): void => {
      made.push(m);
      const what = m.themeOnly ? "theme" : `${m.nodeCount} nodes, ${m.assetCount} assets`;
      console.log(`  ${pc.green("✓")} ${m.title || m.url} ${pc.dim(`(${what}) → ${m.id}`)}`);
    };

    const start = async () =>
      startCaptureSession({
        folderRoot: design.root,
        ...(folderId ? { folderId } : {}),
        ...(url ? { url } : {}),
        ...(statePath ? { sessionStatePath: statePath } : {}),
        onCapture,
        onStatus: (message) => console.log(pc.dim(`  ${message}`)),
      });

    let session: Awaited<ReturnType<typeof startCaptureSession>>;
    try {
      session = await start();
    } catch (err) {
      if (!(err instanceof HeadedBrowserMissingError)) throw err;
      // Chrome is the no-download path; only offer the big install when the
      // machine genuinely has neither browser.
      if (!process.stdin.isTTY) fail("capture", err.message);
      console.log("");
      console.log(`  ${pc.yellow("⚠")} ${err.message}`);
      const proceed = await confirm({
        message: "Download the full browser now? (~300MB, one-time)",
        initialValue: true,
      });
      if (isCancel(proceed) || !proceed) {
        fail("capture", "no browser available for a capture session.");
      }
      if (!(await installChromiumInteractive())) {
        fail("capture", "the browser isn't usable yet — see the output above.");
      }
      session = await start();
    }

    const report = (e: unknown): void => {
      console.log(pc.red(`  capture failed: ${e instanceof Error ? e.message : String(e)}`));
    };
    const unbind = bindKeys({
      page: () => {
        void session.capturePage().catch(report);
      },
      theme: () => {
        void session.captureTheme().catch(report);
      },
      list: () => {
        console.log(pc.dim(`  on: ${session.currentUrl() || "(no page)"}`));
        if (made.length === 0) console.log(pc.dim("  nothing captured yet"));
        for (const m of made) console.log(pc.dim(`  ${m.id}  ${m.title || m.url}`));
      },
      quit: () => {
        void session.close();
      },
    });

    await session.finished;
    unbind();

    console.log("");
    if (made.length === 0) {
      console.log(`  ${pc.dim("No captures made.")}`);
    } else {
      console.log(`  ${pc.green("✓")} ${made.length} capture${made.length === 1 ? "" : "s"} saved`);
      console.log(pc.dim(`    ${capturesDir(design.root, folderId)}`));
      console.log("");
      console.log(pc.dim("  The agent can read these with list_captures / get_capture,"));
      console.log(pc.dim("  and verify a screen against one with compare_to_url { captureId }."));
    }
    // Writing a working login to disk is never a silent side effect.
    if (statePath) {
      console.log("");
      console.log(pc.dim("  Session cookies for this app were saved to:"));
      console.log(pc.dim(`    ${statePath}`));
      console.log(
        pc.dim(
          "  Scoped to that site only (third-party sign-in cookies are dropped), outside your\n" +
            "  repo so it can't be committed or published, and it expires in 14 days.",
        ),
      );
    }
    console.log("");
  },
});
