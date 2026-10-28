import { randomUUID } from "node:crypto";
import { basename, resolve } from "node:path";
import { canvasDistPath } from "@velloo/canvas";
import { managedDesignPath, pickDesign, recordedDesignName } from "@velloo/server";
import pc from "picocolors";
import { appRootIsNotAnApp } from "../../app-root.ts";
import { hasDesignConfig } from "../../design.ts";
import { inheritedFromFolder } from "../../existing-folder.ts";
import { type InitOutcome, startInitServer } from "../../init-web/server.ts";
import { findDesigns } from "../../manifest.ts";
import { openUrl } from "../../open-url.ts";
import type { InitCliArgs } from "../../wizard/args.ts";
import { isValidLibraryId } from "../../wizard/args.ts";
import { printLogo } from "../../wizard/logo.ts";
import { printWired } from "./agent-wiring.ts";
import { displayPath, printScreenshotReadiness } from "./output.ts";

/** Near the daemon's 7300 range, so the setup page reads as Velloo's. */
const INIT_PORT = 7299;
const CTRL_C = "\u0003";

/** The design this directory already has, when init runs where one is. */
async function existingDesign(
  appRoot: string,
  cliArgs: InitCliArgs,
): Promise<{ name: string; folder: string } | undefined> {
  if (cliArgs.force || cliArgs.external || cliArgs.addFolder || cliArgs.designFolder) return;
  const designs = await findDesigns(appRoot);
  const picked = designs ? pickDesign(designs, appRoot) : null;
  const folder =
    picked && picked.reason !== "arbitrary" ? picked.design.root : resolve(appRoot, "velloo");
  if (!(await hasDesignConfig(folder))) return;
  return { name: recordedDesignName(folder) ?? basename(folder), folder };
}

/**
 * Wait for Enter (open the page) until the page is done. Raw mode, so Ctrl+C
 * arrives as a keystroke and cancels the way it would anywhere else.
 */
function untilDone(url: string, outcome: Promise<InitOutcome>): Promise<InitOutcome> {
  const stdin = process.stdin;
  if (!stdin.isTTY) return outcome;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  const onData = (key: string) => {
    if (key === CTRL_C) {
      stdin.setRawMode(false);
      console.log(pc.dim("\n  Cancelled."));
      process.exit(130);
    }
    if (key === "\r" || key === "\n") void openUrl(url);
  };
  stdin.on("data", onData);
  return outcome.finally(() => {
    stdin.off("data", onData);
    stdin.setRawMode(false);
    stdin.pause();
  });
}

/**
 * `velloo init` in a terminal: the questions are asked on a page in the
 * browser, not here. A small setup server serves it, the page writes the
 * design through it, and the design's own canvas takes over — with the agent
 * the person picked already working on the setup in its Agent tab.
 */
export async function runBrowserInit(cliArgs: InitCliArgs): Promise<void> {
  const launchRoot = resolve(cliArgs.folder ?? ".");
  const existing = await existingDesign(launchRoot, cliArgs);
  const inherited = existing ? await inheritedFromFolder(existing.folder) : undefined;
  // A monorepo root is a directory people run init in; the design is for one
  // of its apps. A scan hiccup must not block init — the page then just
  // designs for this directory.
  const apps = cliArgs.folder ? null : await appRootIsNotAnApp(launchRoot).catch(() => null);
  const managedId = randomUUID();
  const managedFolder = managedDesignPath(managedId);
  const pinned =
    cliArgs.library && isValidLibraryId(cliArgs.library)
      ? cliArgs.library
      : inherited?.library && isValidLibraryId(inherited.library)
        ? inherited.library
        : undefined;

  printLogo();
  const server = await startInitServer({
    launchRoot,
    appRoot: apps?.[0]?.dir ?? launchRoot,
    apps: apps ?? [],
    existing,
    scanDir: cliArgs.scanDir,
    pinnedLibrary: pinned,
    inheritComponentsDir: inherited?.componentsDir,
    skipDesignMd: cliArgs.designMd === false,
    ...(cliArgs.external
      ? { fixed: { storage: "external" as const, folder: managedFolder } }
      : cliArgs.designFolder
        ? {
            fixed: {
              storage: "custom" as const,
              folder: resolve(launchRoot, cliArgs.designFolder),
            },
          }
        : {}),
    secondFolder: Boolean(existing || cliArgs.addFolder),
    managedId,
    managedFolder,
    canvasDist: canvasDistPath,
    preferredPort: INIT_PORT,
  });

  console.log(`  Set up Velloo in your browser: ${pc.cyan(server.url)}`);
  console.log(pc.dim(`  Press ${pc.bold("Enter")} to open it · Ctrl+C to cancel`));
  console.log("");

  const outcome = await untilDone(server.url, server.outcome);
  // The page is following its redirect to the canvas; let that response land.
  setTimeout(() => server.stop(), 1000);

  if (outcome.kind === "opened") {
    console.log(`velloo: opened ${displayPath(outcome.folder)} at ${outcome.canvasUrl}`);
  } else {
    const { design } = outcome;
    printWired(design.wireOutcome);
    console.log("");
    console.log(pc.bold(`  ${design.name} is ready`));
    console.log(`    Canvas:  ${pc.cyan(outcome.canvasUrl)}`);
    console.log(`    Design:  ${displayPath(design.folder)}`);
    if (outcome.provider)
      console.log(pc.dim("    Your agent is setting it up in the canvas's Agent tab."));
    console.log("");
    await printScreenshotReadiness();
  }
  console.log(
    pc.dim(
      "  The canvas keeps running in the background while it's open. Reopen it with `velloo run`; stop it with `velloo stop`.",
    ),
  );
}
