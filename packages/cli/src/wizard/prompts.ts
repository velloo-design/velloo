import { resolve } from "node:path";
import { cancel, confirm, isCancel, log, note, select, spinner, text } from "@clack/prompts";
import { readRepoFeedback, topUpTokens } from "@velloo/server";
import pc from "picocolors";
import { defaultCloudUrl } from "../cloud.ts";
import { loadCredential, saveCredential } from "../cloud-credentials.ts";
import { performDeviceLogin, verifyCredential } from "../cloud-login.ts";
import { type AgentWiring, askAgentWiring } from "../connect/index.ts";
import { isDesignFolderSync, isEmptyOrMissingSync } from "../folder.ts";
import { DEFAULT_THEME_PRESET } from "../scaffold/theme-presets.ts";
import { detectHost, findComponentsDir } from "../scan/detect.ts";
import { type AppsScanResult, discoverScanRoots, primaryApp, scanApps } from "../scan/index.ts";
import type { ScannedRoute } from "../scan/types.ts";
import type {
  DetectedHost,
  GoalMode,
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
import { DEFAULT_STACK_ID, stackForFramework } from "./stacks.ts";

function isAborted(value: unknown): value is symbol {
  return isCancel(value);
}

const DEFAULT_COMPONENTS_DIR = "src/components/ui";

/**
 * Where the app keeps its UI components. Nothing to ask when there's no app to
 * put them in, and nothing to ask when the app already has a recognizable
 * components directory — only a real app with an unconventional layout gets
 * the question. Returns null when the user cancelled.
 */
async function resolveComponentsDir(
  appRoot: string,
  hasHostApp: boolean,
  inherited?: string | undefined,
): Promise<{ value: string } | null> {
  // A sibling design folder already answered this for the same app — don't
  // ask twice, and don't let a second folder drift from the first.
  if (inherited) return { value: inherited };
  if (!hasHostApp) return { value: DEFAULT_COMPONENTS_DIR };
  const found = findComponentsDir(appRoot);
  if (found) return { value: found };
  const typed = await text({
    message: subtitledText(
      "Components subfolder inside your app",
      "Where your UI components live — emitted code imports from this path.",
    ),
    placeholder: DEFAULT_COMPONENTS_DIR,
    defaultValue: DEFAULT_COMPONENTS_DIR,
  });
  if (isAborted(typed)) return null;
  return { value: typed || DEFAULT_COMPONENTS_DIR };
}

/**
 * Why this path can't hold a new design folder, or undefined when it can.
 * Shared by the wizard's prompt and the preset path `velloo folder add` passes.
 */
function folderPathProblem(abs: string, shown: string): string | undefined {
  if (isDesignFolderSync(abs))
    return `${shown} is already a Velloo design folder — pick another path.`;
  if (!isEmptyOrMissingSync(abs))
    return `${shown} isn't empty — pick an empty path (or delete it first).`;
  return undefined;
}

/** A `select` message with a dim second line — clack bar-prefixes it for us. */
function subtitled(message: string, subtitle: string): string {
  return `${message}\n${pc.dim(subtitle)}`;
}

/** Same, for `text`, which doesn't bar-prefix continuation lines on its own. */
function subtitledText(message: string, subtitle: string): string {
  return `${message}\n${pc.gray("│")}  ${pc.dim(subtitle)}`;
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
 * primitives, and none at all means velloo's bundled shadcn snapshot.
 */
function describeDetected(d: DetectedHost): string {
  let ui: string;
  let canvas: string;
  if (d.uiLibrary === "shadcn") {
    ui = `shadcn${d.shadcnStyle ? ` (${d.shadcnStyle})` : ""}`;
    canvas =
      "Velloo's own bundled shadcn components — your app's files are not imported, so designs stay in sync by matching the same upstream shadcn";
  } else if (d.uiLibrary) {
    const name = UI_LIBRARY_NAMES[d.uiLibrary];
    ui = name;
    canvas = `real ${name} components bundled with Velloo`;
  } else if (d.unsupportedUi) {
    ui = `${d.unsupportedUi} (no Velloo adapter yet)`;
    canvas = "Velloo's no-library primitives stand in";
  } else {
    ui = "none detected";
    canvas = "Velloo's own bundled shadcn components";
  }
  const lines = [
    `UI library: ${ui}`,
    `Canvas uses: ${canvas}`,
    `Tailwind:   ${d.tailwindMajor ? `v${d.tailwindMajor}` : "not detected"}`,
    `theme css:  ${d.globalsCssPath ?? "not found — will use a preset"}`,
  ];
  return lines.join("\n");
}

/**
 * Promote signing in ("Share for free"), then — only if the user signs in —
 * offer the opt-in feedback tool. Sign-in is global (`~/.velloo`), independent
 * of the folder being created. Returns `{ feedback }` to merge into the wizard
 * answers (feedback omitted unless enabled), or `null` if the user cancels.
 * A sign-in failure is soft: we note it and continue without feedback.
 */
async function promptShareAndFeedback(appRoot: string): Promise<{
  feedback?: { enabled: boolean; contactOk: boolean } | undefined;
} | null> {
  const cloudUrl = defaultCloudUrl();
  let signedIn = false;

  // Feedback consent is a repo preference, answered once. A second design
  // folder in a repo that already answered inherits it silently — re-asking
  // the same person the same consent question is how a wizard wears out its
  // welcome.
  const answered = await readRepoFeedback(appRoot);
  if (answered) {
    log.info(
      `Feedback tool: ${answered.enabled ? "on" : "off"} ${pc.dim("(already set for this repo)")}`,
    );
    return {};
  }

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
 * then a goal-first start menu.
 */
export type InteractiveOutcome = { status: "ok"; answers: WizardAnswers } | { status: "abort" };

/** Ctrl+C or Esc anywhere in the wizard: nothing has been written yet. */
function cancelled(): InteractiveOutcome {
  cancel("Cancelled — no files were written.");
  return { status: "abort" };
}

function outcome(answers: WizardAnswers | null): InteractiveOutcome {
  return answers ? { status: "ok", answers } : cancelled();
}

/**
 * The host-reading goals need UI code to read; `hasHostApp` false (an empty
 * repo, or a backend with no frontend) leaves only the two starts that stand
 * on their own.
 */
export function hostGoalOptions(
  hasHostApp: boolean,
): { value: GoalMode; label: string; hint: string }[] {
  const selfContained: { value: GoalMode; label: string; hint: string }[] = [
    {
      value: "sample",
      label: "Welcome sample",
      hint: "A finished multi-screen app to poke at and reshape",
    },
    {
      value: "blank",
      label: "Blank",
      hint: "Empty canvas — you and your agent build it from nothing",
    },
  ];
  // Nothing local to read: a running site is the only real input left, so this
  // is the one place a browser capture earns a slot in the wizard. With routes
  // to scan it would just be a heavier path to the same place.
  if (!hasHostApp) {
    return [
      {
        value: "capture-site",
        label: "Design from a live site",
        hint: "Open a browser, log in if needed, capture pages — then design from them",
      },
      ...selfContained,
    ];
  }
  return [
    {
      value: "redesign-screen",
      label: "Redesign a screen",
      hint: "Recreate one of your pages, then explore alternatives",
    },
    {
      value: "redesign-component",
      label: "Redesign a component",
      hint: "One region or widget — recreate it, then try variations",
    },
    {
      value: "custom",
      label: "Custom request",
      hint: "Describe any design you need and start there",
    },
    ...selfContained,
  ];
}

export async function runInteractive(ctx: {
  appRoot: string;
  scanDir?: string | undefined;
  /** Ask the agent-wiring question (false under --no-connect). */
  connectEnabled: boolean;
  /** The repo already has a design folder — this run is adding a second one. */
  secondFolder?: boolean | undefined;
  /** Design-folder path already chosen by the caller — skips the prompt. */
  presetFolder?: string | undefined;
  /**
   * The sibling folder's components directory, when adding a second folder to
   * a repo that already answered that question.
   */
  inheritComponentsDir?: string | undefined;
  /** A valid --library flag pins the library — scan adoption won't override it. */
  pinnedLibrary?: LibraryId | undefined;
  /** Why the library is pinned, when it's worth saying (a sibling folder's choice). */
  pinnedLibraryReason?: string | undefined;
}): Promise<InteractiveOutcome> {
  // A second design folder in the same repo can't reuse the default name, and
  // "velloo-2" reads worse than a purpose name — suggest one they'll rename.
  const folderDefault = ctx.secondFolder ? "velloo-brand" : "velloo";
  // `velloo folder add <path>` already answered this — validate the path the
  // way the prompt would, so a bad one fails the same from either entry point.
  if (ctx.presetFolder) {
    const problem = folderPathProblem(resolve(ctx.appRoot, ctx.presetFolder), ctx.presetFolder);
    if (problem) {
      cancel(problem);
      return cancelled();
    }
  }
  const folderInput =
    ctx.presetFolder ??
    (await text({
      message: subtitledText(
        "Design folder name or path",
        ctx.secondFolder
          ? "A second canvas in this repo — its own boards, theme, daemon and MCP endpoint."
          : "Your designs are plain files that live in this repo — commit them alongside your code.",
      ),
      placeholder: folderDefault,
      defaultValue: folderDefault,
      // Validating here is the point: an occupied path is caught the moment
      // it's typed, not after the whole wizard has run and it's time to write.
      validate(value) {
        const raw = (value || folderDefault).trim();
        if (raw === "") return "Path can't be empty.";
        return folderPathProblem(resolve(ctx.appRoot, raw), raw);
      },
    }));
  if (isAborted(folderInput)) return cancelled();
  const folder = resolve(ctx.appRoot, folderInput || folderDefault);

  // Agent wiring is asked up front (config before content) but only applied
  // after the scaffold is written — cancelling anywhere below touches no files.
  let agentWiring: AgentWiring | undefined;
  if (ctx.connectEnabled) {
    // Nothing is written yet, so the app root stands in for the project root
    // a later `connect` would resolve.
    const wiring = await askAgentWiring({ skipWhenCovered: true, projectRoot: ctx.appRoot });
    if (wiring === null) return cancelled();
    agentWiring = wiring;
  }

  // The goal modes that read the host app are dead weight in a repo with no UI
  // code to read, so an empty app root only gets the two self-contained starts.
  const hasHostApp = (await discoverScanRoots(ctx.appRoot)).length > 0;
  const hostCtx = { ...ctx, hasHostApp };

  const goal = await select<GoalMode>({
    message: subtitled(
      "How do you want to start your board?",
      "Pick a real design task — your agent starts on it as soon as init finishes.",
    ),
    options: hostGoalOptions(hasHostApp),
    initialValue: hasHostApp ? "redesign-screen" : "sample",
  });
  if (isAborted(goal)) return cancelled();

  if (goal === "redesign-screen") {
    return outcome(await promptRedesignScreen(hostCtx, folder, agentWiring));
  }
  if (goal === "redesign-component") {
    const desc = await text({
      message: subtitledText(
        "Component name or description",
        "Whatever you'd call it in a code review — the agent finds it from this.",
      ),
      placeholder: "e.g. sidebar, pricing card, filter chip row",
      validate(value) {
        if (!value?.trim()) return "Describe the component so the agent knows what to redesign.";
        return undefined;
      },
    });
    if (isAborted(desc)) return cancelled();
    return outcome(
      await promptGoalWithAdoptedLibrary(hostCtx, folder, agentWiring, "component", {
        componentDescription: String(desc).trim(),
      }),
    );
  }
  if (goal === "custom") {
    const request = await text({
      message: subtitledText(
        "What design do you need?",
        "A sentence is enough — it becomes the brief your agent works from.",
      ),
      placeholder: "e.g. a pricing page with three tiers and a FAQ",
      validate(value) {
        if (!value?.trim()) return "Describe what you want designed.";
        return undefined;
      },
    });
    if (isAborted(request)) return cancelled();
    return outcome(
      await promptGoalWithAdoptedLibrary(hostCtx, folder, agentWiring, "custom", {
        customRequest: String(request).trim(),
      }),
    );
  }
  if (goal === "capture-site") {
    const site = await text({
      message: subtitledText(
        "Site to design from",
        "Init won't open it — your agent starts a capture session so you can log in first.",
      ),
      placeholder: "e.g. https://app.example.com/dashboard",
      validate(value) {
        const v = value?.trim();
        if (!v) return "Enter the URL of the site you want to design from.";
        try {
          const scheme = new URL(v).protocol;
          if (scheme !== "http:" && scheme !== "https:") return "Use an http(s) URL.";
        } catch {
          return "That doesn't look like a URL.";
        }
        return undefined;
      },
    });
    if (isAborted(site)) return cancelled();
    const url = String(site).trim();
    return outcome(
      await promptGoalWithAdoptedLibrary(hostCtx, folder, agentWiring, "custom", {
        captureUrl: url,
        customRequest: `Recreate the pages I capture from ${url}, then explore alternatives.`,
      }),
    );
  }
  if (goal === "blank") {
    return outcome(await buildBlankAnswers(ctx, folder, agentWiring));
  }

  return outcome(await promptSample(hostCtx, folder, agentWiring));
}

async function promptRedesignScreen(
  ctx: {
    appRoot: string;
    scanDir?: string | undefined;
    pinnedLibrary?: LibraryId | undefined;
    pinnedLibraryReason?: string | undefined;
    hasHostApp: boolean;
    inheritComponentsDir?: string | undefined;
  },
  folder: string,
  agentWiring: AgentWiring | undefined,
): Promise<WizardAnswers | null> {
  const how = await select<"scan" | "type">({
    message: subtitled(
      "Which screen should your agent redesign?",
      "Scanning finds your real routes; typing a name works for a screen that doesn't exist yet.",
    ),
    options: [
      {
        value: "scan",
        label: "Pick from my app's routes",
        hint: "Scan routes and choose one",
      },
      {
        value: "type",
        label: "Type a screen name",
        hint: "e.g. Pricing, Settings, Checkout",
      },
    ],
    initialValue: "scan",
  });
  if (isAborted(how)) return null;

  let selectedRoutes: ScannedRoute[] | undefined;
  let screenName: string | undefined;
  let scanRoot = ctx.appRoot;
  let detected: DetectedHost | undefined;
  let library: LibraryId = ctx.pinnedLibrary ?? DEFAULT_LIBRARY_ID;
  let stack = DEFAULT_STACK_ID;

  if (how === "scan") {
    const spin = spinner();
    spin.start("Scanning your app's routes");
    const scanned = await scanApps(ctx.appRoot, ctx.scanDir);
    const appsSuffix = scanned.apps.length > 1 ? ` across ${scanned.apps.length} apps` : "";
    spin.stop(
      scanned.routes.length > 0
        ? `Found ${scanned.routes.length} screen${scanned.routes.length === 1 ? "" : "s"}${appsSuffix}`
        : "No routes detected — type a screen name instead.",
    );

    if (scanned.routes.length === 0) {
      const typed = await text({
        message: "Screen name",
        placeholder: "e.g. Pricing",
        validate(value) {
          if (!value?.trim()) return "Enter a screen name.";
          return undefined;
        },
      });
      if (isAborted(typed)) return null;
      screenName = String(typed).trim();
    } else {
      const rankPrimary = scanned.apps[0];
      if (scanned.apps.length > 1) {
        const lines = scanned.apps.map(
          (a) =>
            `${pc.cyan(a.rel || ".")} — ${a.routes.length} screen${a.routes.length === 1 ? "" : "s"}`,
        );
        note(lines.join("\n"), `Found ${scanned.apps.length} apps`);
      }
      let host = detectHost(rankPrimary?.dir ?? ctx.appRoot);
      note(describeDetected(host), "Detected in your app");

      const picked = await pickOneScreen(scanned);
      if (picked === null) return null;
      selectedRoutes = [picked];
      screenName = picked.name;
      const primary = primaryApp(scanned.apps, [picked]) ?? rankPrimary;
      scanRoot = primary?.dir ?? ctx.appRoot;
      if (primary && primary !== rankPrimary) host = detectHost(primary.dir);
      detected = host;
      stack = stackForFramework(primary?.framework);
      if (!ctx.pinnedLibrary) {
        const adopted = scanAdoption(host);
        if (adopted) library = adopted.library;
      }
    }
  } else {
    const typed = await text({
      message: "Screen name",
      placeholder: "e.g. Pricing",
      validate(value) {
        if (!value?.trim()) return "Enter a screen name.";
        return undefined;
      },
    });
    if (isAborted(typed)) return null;
    screenName = String(typed).trim();
    // Naming a screen skips the route scan, but the library question is still
    // answerable from the host — detect it rather than asking.
    if (!ctx.pinnedLibrary) {
      const adopted = await tryAdoptLibraryFromApp(ctx.appRoot, ctx.scanDir);
      if (adopted) {
        note(describeDetected(adopted.detected), "Detected in your app");
        detected = adopted.detected;
        scanRoot = adopted.scanRoot;
        library = adopted.library;
        stack = adopted.stack;
      }
    }
  }

  const adoptedLibrary = detected ? scanAdoption(detected)?.library : undefined;
  const rest = await promptLibraryThemePath(
    { ...ctx, pinnedLibrary: ctx.pinnedLibrary ?? adoptedLibrary ?? library },
    folder,
    agentWiring,
    "redesign-screen",
    { screenName, selectedRoutes, detected, scanRoot, stack },
    {
      skipLibrary: Boolean(ctx.pinnedLibrary || adoptedLibrary),
      libraryOnly: Boolean(adoptedLibrary),
    },
  );
  if (!rest) return null;
  const finalLibrary = ctx.pinnedLibrary ?? adoptedLibrary ?? rest.library;
  return {
    ...rest,
    library: finalLibrary,
    source: WIZARD_PROVIDERS[finalLibrary].defaultSource,
    scanRoot,
    ...(detected ? { detected } : {}),
    ...(selectedRoutes ? { selectedRoutes } : {}),
    ...(screenName ? { screenName } : {}),
  };
}

/** Pick exactly one scanned route (redesign-a-screen). */
async function pickOneScreen(scanned: AppsScanResult): Promise<ScannedRoute | null> {
  const { routes } = scanned;
  const choice = await select<string>({
    message: "Which screen?",
    options: routes.map((r) => ({
      value: r.id,
      label: r.name,
      hint: r.routePath,
    })),
    ...(routes[0] ? { initialValue: routes[0].id } : {}),
  });
  if (isAborted(choice)) return null;
  return routes.find((r) => r.id === choice) ?? null;
}

/**
 * The library question — unless it's already decided. A pinned library (the
 * `--library` flag, a scan adoption, or the sibling design folder's choice)
 * is not a default to preselect: MUI and shadcn-upstream aren't both in the
 * wizard's list (`interactive: false` hides MUI), so offering the list would
 * silently drop the pinned answer on the floor. Returns null on cancel.
 */
async function resolveLibrary(
  ctx: { pinnedLibrary?: LibraryId | undefined; pinnedLibraryReason?: string | undefined },
  initial: LibraryId = DEFAULT_LIBRARY_ID,
): Promise<LibraryId | null> {
  if (ctx.pinnedLibrary) {
    if (ctx.pinnedLibraryReason) {
      log.info(
        `Component library: ${WIZARD_PROVIDERS[ctx.pinnedLibrary].label} ${pc.dim(`(${ctx.pinnedLibraryReason})`)}`,
      );
    }
    return ctx.pinnedLibrary;
  }
  const picked = await select<LibraryId>({
    message: subtitled(
      "Component library",
      "What the canvas draws with, and what your emitted code imports.",
    ),
    options: interactiveLibraryChoices(),
    initialValue: initial,
  });
  return isAborted(picked) ? null : picked;
}

async function promptSample(
  ctx: {
    appRoot: string;
    pinnedLibrary?: LibraryId | undefined;
    pinnedLibraryReason?: string | undefined;
    hasHostApp: boolean;
    inheritComponentsDir?: string | undefined;
  },
  folder: string,
  agentWiring: AgentWiring | undefined,
): Promise<WizardAnswers | null> {
  const library = await resolveLibrary(ctx);
  if (library === null) return null;
  const provider = WIZARD_PROVIDERS[library];
  const source: LibrarySource = provider.defaultSource;
  let componentsRelative = DEFAULT_COMPONENTS_DIR;
  if (provider.asksComponentsSubfolder) {
    const dir = await resolveComponentsDir(ctx.appRoot, ctx.hasHostApp, ctx.inheritComponentsDir);
    if (!dir) return null;
    componentsRelative = dir.value;
  }

  const share = await promptShareAndFeedback(ctx.appRoot);
  if (share === null) return null;

  note(pc.dim(`App root: ${ctx.appRoot}\nDesign:   ${folder}`), "Setup");
  return {
    appRoot: ctx.appRoot,
    scanRoot: ctx.appRoot,
    folder,
    library,
    source,
    componentsRelative,
    initialContent: "sample",
    themePreset: DEFAULT_THEME_PRESET,
    stack: DEFAULT_STACK_ID,
    ...(agentWiring ? { agentWiring } : {}),
    ...share,
  };
}

/** The zero-question blank folder: no boards, neutral theme, default stack. */
function blankAnswers(
  ctx: { appRoot: string; inheritComponentsDir?: string | undefined },
  folder: string,
  agentWiring: AgentWiring | undefined,
  library: LibraryId,
  extra: Partial<WizardAnswers> = {},
): WizardAnswers {
  return {
    appRoot: ctx.appRoot,
    scanRoot: ctx.appRoot,
    folder,
    library,
    source: WIZARD_PROVIDERS[library].defaultSource,
    componentsRelative: ctx.inheritComponentsDir ?? DEFAULT_COMPONENTS_DIR,
    initialContent: "blank",
    themePreset: "zinc",
    stack: DEFAULT_STACK_ID,
    ...(agentWiring ? { agentWiring } : {}),
    ...extra,
  };
}

/** Blank mode: only the library question, defaulting to no-library. */
async function buildBlankAnswers(
  ctx: {
    appRoot: string;
    scanDir?: string | undefined;
    pinnedLibrary?: LibraryId | undefined;
    pinnedLibraryReason?: string | undefined;
    inheritComponentsDir?: string | undefined;
  },
  folder: string,
  agentWiring: AgentWiring | undefined,
  defaultLibrary: LibraryId = "none",
): Promise<WizardAnswers | null> {
  const library = await resolveLibrary(ctx, defaultLibrary);
  if (library === null) return null;
  const share = await promptShareAndFeedback(ctx.appRoot);
  if (share === null) return null;

  note(pc.dim(`App root: ${ctx.appRoot}\nDesign:   ${folder}`), "Setup");
  return blankAnswers(ctx, folder, agentWiring, library, share);
}

/**
 * Brand / component / custom: scan the host first and auto-adopt its library
 * when detectable, so we don't ask unless adoption fails or --library pinned.
 */
async function promptGoalWithAdoptedLibrary(
  ctx: {
    appRoot: string;
    scanDir?: string | undefined;
    pinnedLibrary?: LibraryId | undefined;
    pinnedLibraryReason?: string | undefined;
    hasHostApp: boolean;
    inheritComponentsDir?: string | undefined;
  },
  folder: string,
  agentWiring: AgentWiring | undefined,
  initialContent: InitialContent,
  extra: Partial<WizardAnswers> = {},
): Promise<WizardAnswers | null> {
  const adopted = ctx.pinnedLibrary ? null : await tryAdoptLibraryFromApp(ctx.appRoot, ctx.scanDir);
  if (adopted) {
    note(describeDetected(adopted.detected), "Detected in your app");
    note(`Using ${WIZARD_PROVIDERS[adopted.library].label}.`, "Library");
  }
  return promptLibraryThemePath(
    {
      ...ctx,
      pinnedLibrary: ctx.pinnedLibrary ?? adopted?.library,
    },
    folder,
    agentWiring,
    initialContent,
    {
      ...extra,
      ...(adopted
        ? { detected: adopted.detected, scanRoot: adopted.scanRoot, stack: adopted.stack }
        : {}),
    },
    {
      skipLibrary: Boolean(ctx.pinnedLibrary || adopted),
      // Host detection already framed the library; skip theme/stack/subfolder
      // and import the host theme in resolveTheme when available.
      libraryOnly: Boolean(adopted),
    },
  );
}

/** Soft host scan — returns null when nothing adoptable is found. */
async function tryAdoptLibraryFromApp(
  appRoot: string,
  scanDir?: string | undefined,
): Promise<{
  library: LibraryId;
  detected: DetectedHost;
  scanRoot: string;
  stack: string;
} | null> {
  const spin = spinner();
  spin.start("Detecting your app's UI library");
  try {
    const scanned = await scanApps(appRoot, scanDir);
    const primary = scanned.apps[0];
    const scanRoot = primary?.dir ?? appRoot;
    const detected = detectHost(scanRoot);
    const adopted = scanAdoption(detected);
    spin.stop(
      adopted
        ? `Detected ${WIZARD_PROVIDERS[adopted.library].label}`
        : "No UI library detected — you'll pick one next.",
    );
    if (!adopted) return null;
    return {
      library: adopted.library,
      detected,
      scanRoot,
      stack: stackForFramework(primary?.framework),
    };
  } catch {
    spin.stop("Couldn't scan the app — you'll pick a library next.");
    return null;
  }
}

async function promptLibraryThemePath(
  ctx: {
    appRoot: string;
    pinnedLibrary?: LibraryId | undefined;
    pinnedLibraryReason?: string | undefined;
    hasHostApp: boolean;
    inheritComponentsDir?: string | undefined;
  },
  folder: string,
  agentWiring: AgentWiring | undefined,
  initialContent: InitialContent,
  extra: Partial<WizardAnswers> = {},
  opts: { skipLibrary?: boolean; libraryOnly?: boolean } = {},
): Promise<WizardAnswers | null> {
  let library: LibraryId = ctx.pinnedLibrary ?? DEFAULT_LIBRARY_ID;
  if (!opts.skipLibrary) {
    const picked = await resolveLibrary(ctx);
    if (picked === null) return null;
    library = picked;
  }
  const provider = WIZARD_PROVIDERS[library];
  const source: LibrarySource = provider.defaultSource;
  let componentsRelative = DEFAULT_COMPONENTS_DIR;

  if (!opts.libraryOnly && provider.asksComponentsSubfolder) {
    const dir = await resolveComponentsDir(ctx.appRoot, ctx.hasHostApp, ctx.inheritComponentsDir);
    if (!dir) return null;
    componentsRelative = dir.value;
  }
  // Blank stays deliberately neutral; every other start gets the house theme.
  // A detected host theme overrides this in `resolveTheme`.
  const themePreset = initialContent === "blank" ? "zinc" : DEFAULT_THEME_PRESET;

  const share = await promptShareAndFeedback(ctx.appRoot);
  if (share === null) return null;

  note(pc.dim(`App root: ${ctx.appRoot}\nDesign:   ${folder}`), "Setup");
  return {
    appRoot: ctx.appRoot,
    scanRoot: extra.scanRoot ?? ctx.appRoot,
    folder,
    library,
    source,
    componentsRelative,
    initialContent,
    themePreset,
    stack: extra.stack ?? DEFAULT_STACK_ID,
    ...(agentWiring ? { agentWiring } : {}),
    ...share,
    ...extra,
  };
}
