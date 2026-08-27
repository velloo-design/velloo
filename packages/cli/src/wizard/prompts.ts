import { readdir } from "node:fs/promises";
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
import { topUpTokens } from "@velloo/server";
import pc from "picocolors";
import { defaultCloudUrl } from "../cloud.ts";
import { loadCredential, saveCredential } from "../cloud-credentials.ts";
import { performDeviceLogin, verifyCredential } from "../cloud-login.ts";
import { type AgentWiring, askAgentWiring } from "../connect/index.ts";
import type { ProductSurface } from "../scaffold/sample-page.ts";
import { THEME_PRESETS } from "../scaffold/theme-presets.ts";
import { VIBES } from "../scaffold/vibes.ts";
import { detectHost } from "../scan/detect.ts";
import { type AppsScanResult, primaryApp, scanApps } from "../scan/index.ts";
import type { ScannedRoute } from "../scan/types.ts";
import type {
  DetectedHost,
  InitialContent,
  LibraryId,
  LibrarySource,
  WizardAnswers,
} from "./answers.ts";
import {
  DEFAULT_LIBRARY_ID,
  interactiveLibraryChoices,
  scanAdoption,
  WIZARD_PROVIDERS,
} from "./provider-registry.ts";
import { STACKS } from "./stacks.ts";

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

const UI_LIBRARY_NAMES: Record<NonNullable<DetectedHost["uiLibrary"]>, string> = {
  shadcn: "shadcn",
  mui: "Material UI",
  antd: "Ant Design",
  chakra: "Chakra UI",
};

/**
 * The "Detected in your app" box: leads with the UI framework and what velloo
 * will do about it — a supported one becomes the folder's adapter, an
 * unsupported one (Mantine, Untitled UI, …) falls back to the no-framework
 * primitives, and none at all means velloo's shadcn default.
 */
function describeDetected(d: DetectedHost): string {
  let ui: string;
  if (d.uiLibrary) {
    const name = UI_LIBRARY_NAMES[d.uiLibrary];
    const style = d.uiLibrary === "shadcn" && d.shadcnStyle ? ` (${d.shadcnStyle})` : "";
    ui = `${name}${style} — velloo designs with ${d.uiLibrary === "shadcn" ? "its own shadcn components" : `real ${name} components`}`;
  } else if (d.unsupportedUi) {
    ui = `${d.unsupportedUi} — no velloo adapter yet; the no-framework primitives stand in`;
  } else {
    ui = "no compatible UI framework detected — velloo's shadcn components will be used";
  }
  const lines = [
    `UI library: ${ui}`,
    `Tailwind:   ${d.tailwindMajor ? `v${d.tailwindMajor}` : "not detected"}`,
    `theme css:  ${d.globalsCssPath ?? "not found — will use a preset"}`,
  ];
  return lines.join("\n");
}

/**
 * Let the user choose which scanned routes to scaffold into screens + board
 * frames. The top (default) option scaffolds everything and flags the handoff
 * prompt to let the agent pick the first screen to design; "let me pick"
 * drops into a multiselect grouped per app (a monorepo scan has several —
 * each group header is a real select-all/none toggle). Returns the chosen
 * routes ([] when the user unchecks everything → init falls back to a blank
 * board) plus the agent-picks-first flag, or null when the user cancels.
 */
async function pickScreens(
  scanned: AppsScanResult,
): Promise<{ routes: ScannedRoute[]; agentPicksFirst: boolean } | null> {
  const { apps, routes } = scanned;

  const mode = await select<"all" | "choose">({
    message: "Which screens should I scaffold as placeholders?",
    options: [
      {
        value: "all",
        label: `All ${routes.length} — my agent picks where to start`,
        hint: "recommended",
      },
      { value: "choose", label: "Let me pick which screens to include" },
    ],
    initialValue: "all",
  });
  if (isAborted(mode)) return null;
  if (mode === "all") return { routes, agentPicksFirst: true };

  // One selectable group per app (a single-app scan gets one "All screens"
  // group): the header toggles the whole app's screens at once; individual
  // screens can still be unchecked to prune. Group keys never appear in the
  // result — only the per-screen ids do. Multi-app labels drop the "Web / "
  // name prefix the scan added, since the group header already names the app.
  const options: Record<string, { value: string; label: string; hint?: string }[]> = {};
  if (apps.length > 1) {
    for (const app of apps) {
      options[app.rel || "app root"] = app.routes.map((r) => ({
        value: r.id,
        label: r.name.replace(/^[^/]+ \/ /, ""),
        hint: r.routePath,
      }));
    }
  } else {
    options["All screens"] = routes.map((r) => ({ value: r.id, label: r.name, hint: r.routePath }));
  }
  const picked = await groupMultiselect<string>({
    message: "Which screens should I build boards for?",
    options,
    initialValues: routes.map((r) => r.id),
    selectableGroups: true,
    required: false,
  });
  if (isAborted(picked)) return null;

  const chosen = new Set(picked);
  return { routes: routes.filter((r) => chosen.has(r.id)), agentPicksFirst: false };
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
  const cloudUrl = defaultCloudUrl();
  let signedIn = false;

  // Sticky login: if ~/.velloo already holds a valid credential, don't ask to
  // sign in again — note who we are and go straight to the feedback opt-in.
  const existing = await loadCredential(cloudUrl);
  const existingEmail = existing ? await verifyCredential(cloudUrl, existing.token) : null;
  if (existingEmail) {
    note(`Signed in as ${existingEmail}.`, "Velloo cloud");
    signedIn = true;
  }

  if (!signedIn) {
    const ok = await promptSignIn(cloudUrl);
    if (ok === null) return null; // cancelled the whole wizard
    signedIn = ok;
  }

  if (!signedIn) return {};

  const details = [
    "The `send_feedback` tool lets your agent send free-text product feedback",
    "about Velloo itself — a confusing tool, a missing capability, something",
    "that slowed it down. Never about your design or your project.",
    "",
    "How it behaves:",
    "  - The agent always shows you the exact message and asks before sending.",
    "  - It is instructed to never include your design content, code, or",
    "    file/repo paths — only a plain-prose description of the issue.",
    `  - "Yes": anonymous by construction — the message is sent with a`,
    "    blind-signed token (RFC 9474) instead of your account, so the server",
    "    can verify it came from a real signed-in user but cannot tell which",
    "    one. The whole flow lives in velloo's open-source CLI, so you don't",
    "    have to take the cloud's word for it.",
    `  - "Yes — contact OK": sent from your account so we can reply by email.`,
    `  - "No": the tool is never registered, so the agent can't send anything.`,
  ].join("\n");

  // clack's select has no key-hook for a "press ? for more" footer, so the
  // details live behind a re-asking option instead.
  let choice: "yes" | "yes-contact" | "no";
  for (;;) {
    const picked = await select<"yes" | "yes-contact" | "no" | "details">({
      message:
        "Enable the feedback tool? Your agent can send Velloo product feedback to improve it.",
      options: [
        {
          value: "yes",
          label: "Yes — anonymous feedback",
          hint: "agent always confirms with you before sending",
        },
        {
          value: "yes-contact",
          label: "Yes — and it's OK to contact me about it",
          hint: "we may follow up by email",
        },
        { value: "no", label: "No", hint: "the tool is disabled entirely" },
        {
          value: "details",
          label: "What exactly gets sent?",
          hint: "prints details, then re-asks",
        },
      ],
      initialValue: "yes",
    });
    if (isAborted(picked)) return null;
    if (picked !== "details") {
      choice = picked;
      break;
    }
    note(details, "The feedback tool");
  }
  if (choice === "no") return {};

  // Anonymous feedback spends blind-signed tokens; pre-fetch a batch NOW so
  // a later send doesn't time-correlate with its issuance. Best-effort — the
  // send path tops up on demand. The blind-RSA round trips take a moment, so
  // show a spinner rather than letting the wizard look frozen.
  if (choice === "yes") {
    const cred = await loadCredential(cloudUrl);
    if (cred) {
      const spin = spinner();
      spin.start("Stocking anonymous feedback tokens");
      await topUpTokens({ url: cloudUrl, token: cred.token }, 10)
        .then(() => spin.stop("Anonymous feedback tokens ready"))
        .catch(() => spin.stop("Feedback enabled — tokens will be fetched on first send"));
    }
  }
  return { feedback: { enabled: true, contactOk: choice === "yes-contact" } };
}

/**
 * The interactive sign-in step: confirm intent, then run the device flow.
 * Returns true on a completed sign-in, false if the user declines or skips
 * (soft), or null if they cancel the whole wizard.
 */
async function promptSignIn(cloudUrl: string): Promise<boolean | null> {
  const wantShare = await confirm({
    message: "Share your designs for free? Sign up to publish branded share links.",
    initialValue: true,
  });
  if (isAborted(wantShare)) return null;
  if (!wantShare) return false;

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
          `Opening your browser to sign up (or sign in).\nIf it doesn't open, visit:\n${pc.cyan(verificationUrl)}\nand enter the code: ${pc.bold(userCode)}\n\n${pc.dim("Press Esc to skip and continue without signing in.")}`,
          "Sign up",
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
  return signedIn;
}

/**
 * Interactive prompts for `velloo init`. `appRoot` is the user's app (where
 * Velloo installs). Config comes first — design folder, then agent wiring —
 * so the scan flow runs straight into handing its screens to a wired agent.
 */
export async function runInteractive(ctx: {
  appRoot: string;
  scanDir?: string;
  /** Ask the agent-wiring question (false under --no-connect). */
  connectEnabled: boolean;
  /** A valid --library flag pins the library — scan adoption won't override it. */
  pinnedLibrary?: LibraryId;
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

  // Agent wiring is asked up front (config before content) but only applied
  // after the scaffold is written — cancelling anywhere below this still
  // means no files were touched.
  let agentWiring: AgentWiring | undefined;
  if (ctx.connectEnabled) {
    const wiring = await askAgentWiring({ skipWhenCovered: true });
    if (wiring === null) return abort();
    agentWiring = wiring;
  }

  // An empty app root has nothing to scan, so scratch leads; anywhere with
  // real content defaults to mirroring what's there.
  const rootEntries = await readdir(ctx.appRoot).catch(() => [] as string[]);
  const emptyRoot = rootEntries.filter((e) => !e.startsWith(".")).length === 0;
  const startOptions = {
    scan: {
      value: "scan" as const,
      label: "Scan what I have",
      hint: "Detect your routes + theme and build a starting board",
    },
    scratch: {
      value: "scratch" as const,
      label: "Start from scratch",
      hint: "Pick a component library + a sample or blank board",
    },
  };
  const start = await select<"scratch" | "scan">({
    message: "How do you want to start?",
    options: emptyRoot
      ? [startOptions.scratch, startOptions.scan]
      : [startOptions.scan, startOptions.scratch],
    initialValue: emptyRoot ? "scratch" : "scan",
  });
  if (isAborted(start)) return abort();

  if (start === "scan") {
    const spin = spinner();
    spin.start("Scanning your app's routes");
    const scanned = await scanApps(ctx.appRoot, ctx.scanDir);
    const appsSuffix = scanned.apps.length > 1 ? ` across ${scanned.apps.length} apps` : "";
    spin.stop(
      scanned.routes.length > 0
        ? `Found ${scanned.routes.length} screen${scanned.routes.length === 1 ? "" : "s"}${appsSuffix}`
        : "No routes detected — let's set up from scratch instead.",
    );

    if (scanned.routes.length > 0) {
      // Rank-best app drives detection until the user picks screens; then the
      // app contributing most of the selection takes over (theme + hostApp).
      const rankPrimary = scanned.apps[0];
      if (scanned.apps.length > 1) {
        const lines = scanned.apps.map(
          (a) =>
            `${pc.cyan(a.rel || ".")} — ${a.routes.length} screen${a.routes.length === 1 ? "" : "s"}`,
        );
        lines.push("", "Each app gets its own board; screen ids are prefixed per app.");
        note(lines.join("\n"), `Found ${scanned.apps.length} apps`);
      } else if (rankPrimary?.rel && rankPrimary.rel !== ".") {
        note(
          `Your app root has no package.json — scanning ${pc.cyan(rankPrimary.rel)} instead.`,
          ctx.scanDir ? "Scanning subfolder" : "Found your UI",
        );
      }
      let detected = detectHost(rankPrimary?.dir ?? ctx.appRoot);
      note(describeDetected(detected), "Detected in your app");

      const picked = await pickScreens(scanned);
      if (picked === null) return abort();
      // Theme import + hostApp follow the app the user actually kept.
      const primary = primaryApp(scanned.apps, picked.routes) ?? rankPrimary;
      const scanRoot = primary?.dir ?? ctx.appRoot;
      if (primary && primary !== rankPrimary) detected = detectHost(primary.dir);

      const share = await promptShareAndFeedback();
      if (share === null) return abort();
      // The "existing project" flow: design in the framework the app actually
      // uses (a MUI host → the MUI adapter, an unsupported framework → the
      // no-framework primitives) unless --library pinned one.
      const adopted = ctx.pinnedLibrary ? undefined : scanAdoption(detected);
      return {
        appRoot: ctx.appRoot,
        scanRoot,
        folder,
        // Scan renders against runtimes bundled with the velloo binary and
        // imports the host theme; it never writes into the app (source: "binary").
        library: ctx.pinnedLibrary ?? adopted?.library ?? DEFAULT_LIBRARY_ID,
        source: "binary",
        componentsRelative: "src/components/ui",
        initialContent: "scan",
        detected,
        selectedRoutes: picked.routes,
        agentPicksFirst: picked.agentPicksFirst,
        ...(agentWiring ? { agentWiring } : {}),
        ...share,
      };
    }
    // Nothing scannable — fall through to the scratch questions rather than
    // silently defaulting to a shadcn/indigo blank folder.
  }

  const library = await select<LibraryId>({
    message: "Component library",
    options: interactiveLibraryChoices(),
    initialValue: ctx.pinnedLibrary ?? DEFAULT_LIBRARY_ID,
  });
  if (isAborted(library)) return abort();
  const provider = WIZARD_PROVIDERS[library];

  // Source is derived from the library: upstream lives in the app (written
  // post-init), everything else renders from the bundled snapshot.
  const source: LibrarySource = provider.defaultSource;
  let componentsRelative = "src/components/ui";
  if (provider.asksComponentsSubfolder) {
    const cr = await text({
      message: "Components subfolder inside your app",
      placeholder: "src/components/ui",
      defaultValue: "src/components/ui",
    });
    if (isAborted(cr)) return abort();
    if (cr) componentsRelative = cr;
  }

  // The product surface folds the old sample-vs-blank question into "what
  // are you designing?" — the answer picks which slice of Pulse ships. A
  // library without surfaces (its welcome sample has none) keeps the plain
  // pair.
  let initialContent: Exclude<InitialContent, "scan">;
  let productSurface: ProductSurface | undefined;
  if (!provider.hasProductSurfaces) {
    const content = await select<Exclude<InitialContent, "scan">>({
      message: "Initial design",
      options: [
        { value: "sample", label: "Welcome sample", hint: "A small primitives demo" },
        { value: "blank", label: "Blank", hint: "Empty board, no screens" },
      ],
      initialValue: "sample",
    });
    if (isAborted(content)) return abort();
    initialContent = content;
  } else {
    const surface = await select<ProductSurface | "blank">({
      message: "What are you designing? (tailors the Pulse starter)",
      options: [
        { value: "saas", label: "A full product", hint: "all of Pulse — 7 screens, 3 boards" },
        {
          value: "analytics",
          label: "An app / dashboard",
          hint: "Pulse's App board — dashboard, insights, settings",
        },
        {
          value: "marketing",
          label: "A marketing site",
          hint: "Pulse's Marketing board — landing, pricing, sign-up",
        },
        { value: "blank", label: "Blank", hint: "Empty board, no screens" },
      ],
      initialValue: "saas",
    });
    if (isAborted(surface)) return abort();
    initialContent = surface === "blank" ? "blank" : "sample";
    if (surface !== "blank") productSurface = surface;
  }

  let themePreset: string | undefined;
  let themeVibe: string | undefined;
  if (provider.asksThemePreset) {
    const preset = await select<string>({
      message: "Theme",
      options: [
        ...THEME_PRESETS.map((p) => ({
          value: p.id,
          label: `${swatch(p.seed)} ${p.label}`,
        })),
        { value: "vibe", label: "Pick by vibe…", hint: "playful / calm / premium / …" },
      ],
      initialValue: "indigo",
    });
    if (isAborted(preset)) return abort();
    if (preset === "vibe") {
      const vibe = await select<string>({
        message: "How should it feel?",
        options: VIBES.map((v) => ({
          value: v.id,
          label: `${swatch(v.seed)} ${v.label}`,
          hint: v.description,
        })),
        initialValue: VIBES[0]?.id,
      });
      if (isAborted(vibe)) return abort();
      themeVibe = typeof vibe === "string" ? vibe : undefined;
    } else {
      themePreset = typeof preset === "string" ? preset : undefined;
    }
  }

  // Stack → codegen import alias. Only shadcn emits aliased component
  // imports, so the question is noise for the no-library flow.
  let stack: string | undefined;
  if (provider.asksStack) {
    const picked = await select<string>({
      message: "Your app's stack (sets the import alias emitted code uses)",
      options: [
        ...STACKS.map((s) => ({ value: s.id, label: s.label, hint: s.alias })),
        { value: "skip", label: "Skip", hint: "decide later — defaults to @/components/ui" },
      ],
      initialValue: "nextjs",
    });
    if (isAborted(picked)) return abort();
    if (picked !== "skip") stack = picked;
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
    productSurface,
    themePreset,
    themeVibe,
    stack,
    ...(agentWiring ? { agentWiring } : {}),
    ...share,
  };
}
