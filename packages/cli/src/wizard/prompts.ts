import { resolve } from "node:path";
import {
  cancel,
  confirm,
  groupMultiselect,
  isCancel,
  note,
  select,
  spinner,
  text,
} from "@clack/prompts";
import pc from "picocolors";
import { defaultCloudUrl } from "../cloud.ts";
import { saveCredential } from "../cloud-credentials.ts";
import { performDeviceLogin } from "../cloud-login.ts";
import { THEME_PRESETS } from "../scaffold/theme-presets.ts";
import { detectHost } from "../scan/detect.ts";
import { resolveScanRoot, scanAppRoutes } from "../scan/index.ts";
import type { ScannedRoute } from "../scan/types.ts";
import type { InitialContent, LibraryId, LibrarySource, WizardAnswers } from "./answers.ts";

function isAborted(value: unknown): value is symbol {
  return isCancel(value);
}

function abort(): null {
  cancel("Cancelled — no files were written.");
  return null;
}

/** A true-color terminal swatch (two blocks) for a hex color. */
function swatch(hex: string): string {
  const m = hex.replace("#", "").match(/.{2}/g);
  if (!m || m.length < 3) return "  ";
  const [r, g, b] = m.map((h) => Number.parseInt(h, 16));
  return `\x1b[48;2;${r};${g};${b}m  \x1b[0m`;
}

function describeDetected(d: ReturnType<typeof detectHost>): string {
  const lines = [
    `shadcn:    ${d.shadcn ? `yes${d.shadcnStyle ? ` (${d.shadcnStyle})` : ""}` : "not detected"}`,
    `Tailwind:  ${d.tailwindMajor ? `v${d.tailwindMajor}` : "not detected"}`,
    `theme css: ${d.globalsCssPath ?? "not found — will use a preset"}`,
  ];
  return lines.join("\n");
}

/**
 * Scan the host app's routes and let the user choose which to scaffold into
 * screens + board frames. Every screen is pre-checked, so just pressing Enter
 * builds them all (matching the non-interactive path). The "All screens" group
 * header is a real select-all/none: toggling it (space) checks or unchecks
 * every screen at once; individual screens can still be unchecked to prune.
 * Returns the chosen routes ([] when none are detected or the user unchecks
 * everything → init falls back to a blank board) or null when the user cancels.
 */
async function pickScreens(appRoot: string): Promise<ScannedRoute[] | null> {
  const spin = spinner();
  spin.start("Scanning your app's routes");
  const { routes } = await scanAppRoutes(appRoot);
  spin.stop(
    routes.length > 0
      ? `Found ${routes.length} screen${routes.length === 1 ? "" : "s"}`
      : "No routes detected — starting with a blank board",
  );
  if (routes.length === 0) return [];

  // A single selectable group: its header toggles all screens (the group key
  // never appears in the result — only the per-screen ids do).
  const picked = await groupMultiselect<string>({
    message: "Which screens should I build boards for?",
    options: {
      "All screens": routes.map((r) => ({ value: r.id, label: r.name, hint: r.routePath })),
    },
    initialValues: routes.map((r) => r.id),
    selectableGroups: true,
    required: false,
  });
  if (isAborted(picked)) return null;

  const chosen = new Set(picked);
  return routes.filter((r) => chosen.has(r.id));
}

/**
 * Promote signing in ("Share for free"), then — only if the user signs in —
 * offer the opt-in feedback tool. Sign-in is global (`~/.velloo`), independent
 * of the folder being created. Returns `{ feedback }` to merge into the wizard
 * answers (feedback omitted unless enabled), or `null` if the user cancels.
 * A sign-in failure is soft: we note it and continue without feedback.
 */
async function promptShareAndFeedback(): Promise<{
  feedback?: { enabled: boolean; contactOk: boolean };
} | null> {
  const wantShare = await confirm({
    message: "Share your designs for free? Sign in to publish branded share links.",
    initialValue: false,
  });
  if (isAborted(wantShare)) return null;
  if (!wantShare) return {};

  const cloudUrl = defaultCloudUrl();
  const spin = spinner();
  let signedIn = false;

  const controller = new AbortController();
  const hadRaw = process.stdin.isRaw ?? false;
  if (process.stdin.isTTY && !hadRaw) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
  }
  const onKey = (buf: Buffer) => {
    if (buf[0] === 0x1b) controller.abort();
  };
  process.stdin.on("data", onKey);

  try {
    const cred = await performDeviceLogin(
      cloudUrl,
      ({ verificationUrl, userCode }) => {
        note(
          `Opening your browser to sign in.\nIf it doesn't open, visit:\n${pc.cyan(verificationUrl)}\nand enter the code: ${pc.bold(userCode)}\n\n${pc.dim("Press Esc to skip and continue without signing in.")}`,
          "Sign in",
        );
        spin.start("Waiting for sign-in  (Esc to skip)");
      },
      controller.signal,
    );
    await saveCredential(cloudUrl, cred);
    spin.stop(`Signed in as ${cred.email}`);
    signedIn = true;
  } catch (err) {
    if (controller.signal.aborted) {
      spin.stop("Sign-in skipped — continuing without it.");
    } else {
      spin.stop("Sign-in failed");
      note(
        `Couldn't sign in (${err instanceof Error ? err.message : String(err)}).\nYou can run ${pc.cyan("velloo login")} anytime later.`,
        "Heads up",
      );
    }
  } finally {
    process.stdin.off("data", onKey);
    // A user who gives up tends to tap Esc more than once. Swallow any input
    // still buffered (or arriving in the next breath) so a stray Esc doesn't
    // leak into clack's next prompt — clack reads Esc as "cancel", which would
    // silently skip the agent-wiring (MCP setup) step.
    if (controller.signal.aborted && process.stdin.isTTY) {
      const drain = () => {};
      process.stdin.on("data", drain);
      await new Promise<void>((r) => setTimeout(r, 150));
      process.stdin.off("data", drain);
    }
    if (process.stdin.isTTY && !hadRaw) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
  }
  if (!signedIn) return {};

  const choice = await select<"yes" | "yes-contact" | "no">({
    message: "Enable the feedback tool? Your agent can send Velloo product feedback to improve it.",
    options: [
      { value: "yes", label: "Yes", hint: "Agent can send product feedback" },
      {
        value: "yes-contact",
        label: "Yes — and it's OK to contact me about it",
        hint: "We may follow up by email",
      },
      { value: "no", label: "No", hint: "Don't enable feedback" },
    ],
    initialValue: "yes",
  });
  if (isAborted(choice)) return null;
  if (choice === "no") return {};
  return { feedback: { enabled: true, contactOk: choice === "yes-contact" } };
}

/**
 * Interactive prompts for `velloo init`. `appRoot` is the user's app (where
 * Velloo installs); the flow asks scratch-vs-scan first, then only the
 * questions that choice needs.
 */
export async function runInteractive(ctx: {
  appRoot: string;
  scanDir?: string;
}): Promise<WizardAnswers | null> {
  const folderInput = await text({
    message: "Where should the design folder live?",
    placeholder: "velloo",
    defaultValue: "velloo",
    validate(value) {
      if (value && value.trim() === "") return "Path can't be empty.";
      return undefined;
    },
  });
  if (isAborted(folderInput)) return abort();
  const folder = resolve(ctx.appRoot, folderInput || "velloo");

  const start = await select<"scratch" | "scan">({
    message: "How do you want to start?",
    options: [
      {
        value: "scratch",
        label: "Start from scratch",
        hint: "Pick a component library + a sample or blank board",
      },
      {
        value: "scan",
        label: "Scan what I have",
        hint: "Detect your routes + theme and build a starting board",
      },
    ],
    initialValue: "scratch",
  });
  if (isAborted(start)) return abort();

  if (start === "scan") {
    const { scanRoot, relToApp, autoDiscovered } = await resolveScanRoot(ctx.appRoot, ctx.scanDir);
    if (relToApp && relToApp !== ".") {
      note(
        `Your app root has no package.json — scanning ${pc.cyan(relToApp)} instead.`,
        autoDiscovered ? "Found your UI" : "Scanning subfolder",
      );
    }
    const detected = detectHost(scanRoot);
    note(describeDetected(detected), "Detected in your app");
    const selectedRoutes = await pickScreens(scanRoot);
    if (selectedRoutes === null) return abort();
    const share = await promptShareAndFeedback();
    if (share === null) return abort();
    return {
      appRoot: ctx.appRoot,
      scanRoot,
      folder,
      // Scan renders against the bundled snapshot and imports the host theme;
      // it never writes into the app.
      library: "shadcn-react",
      source: "binary",
      componentsRelative: "src/components/ui",
      initialContent: "scan",
      detected,
      selectedRoutes,
      ...share,
    };
  }

  const library = await select<LibraryId>({
    message: "Component library",
    options: [
      {
        value: "shadcn-upstream",
        label: "shadcn (upstream)",
        hint: "Vanilla shadcn added to your app. Recommended.",
      },
      {
        value: "shadcn-react",
        label: "shadcn (vendored snapshot)",
        hint: "Bundled with velloo — shadcn is NOT downloaded.",
      },
      {
        value: "none",
        label: "No library",
        hint: "Box / Stack / Text primitives.",
      },
    ],
    initialValue: "shadcn-upstream",
  });
  if (isAborted(library)) return abort();

  // Source is derived from the library: upstream lives in the app (written
  // post-init), everything else renders from the bundled snapshot.
  let source: LibrarySource = "binary";
  let componentsRelative = "src/components/ui";
  if (library === "shadcn-upstream") {
    source = "in-repo";
    const cr = await text({
      message: "Components subfolder inside your app",
      placeholder: "src/components/ui",
      defaultValue: "src/components/ui",
    });
    if (isAborted(cr)) return abort();
    if (cr) componentsRelative = cr;
  }

  const initialContent = await select<Exclude<InitialContent, "scan">>({
    message: "Initial design",
    options: [
      {
        value: "sample",
        label: library === "none" ? "Welcome sample" : "Pulse sample",
        hint: library === "none" ? "A small primitives demo" : "7 screens, 3 boards",
      },
      { value: "blank", label: "Blank", hint: "Empty board, no screens" },
    ],
    initialValue: "sample",
  });
  if (isAborted(initialContent)) return abort();

  let themePreset: string | undefined;
  if (library === "shadcn-upstream" || library === "shadcn-react") {
    const preset = await select<string>({
      message: "Theme preset",
      options: THEME_PRESETS.map((p) => ({
        value: p.id,
        label: `${swatch(p.seed)} ${p.label}`,
      })),
      initialValue: "indigo",
    });
    if (isAborted(preset)) return abort();
    themePreset = typeof preset === "string" ? preset : undefined;
  }

  const share = await promptShareAndFeedback();
  if (share === null) return abort();

  note(pc.dim(`App root: ${ctx.appRoot}\nDesign:   ${folder}`), "Setup");

  return {
    appRoot: ctx.appRoot,
    scanRoot: ctx.appRoot,
    folder,
    library,
    source,
    componentsRelative,
    initialContent,
    themePreset,
    ...share,
  };
}
