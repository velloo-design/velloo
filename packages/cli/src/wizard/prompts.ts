import { resolve } from "node:path";
import { cancel, log, select, text } from "@clack/prompts";
import { type AgentWiring, askAgentWiring } from "../connect/index.ts";
import { isDesignFolderSync, isEmptyOrMissingSync } from "../folder.ts";
import { checkoutRoot, isWithin } from "../manifest.ts";
import { discoverScanRoots } from "../scan/index.ts";
import type { GoalMode, WizardAnswers } from "./answers.ts";
import {
  buildBlankAnswers,
  promptGoalWithAdoptedLibrary,
  promptRedesignScreen,
  promptSample,
} from "./goal-prompts.ts";
import { isAborted, subtitled, subtitledText, type WizardContext } from "./prompt-kit.ts";

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
      label: "Elsewhere welcome sample",
      hint: "Travel app with imagery, dark mode and three agentic trip explorations",
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

/** A required one-line brief; null when the user cancelled. */
async function promptBrief(opts: {
  message: string;
  subtitle: string;
  placeholder: string;
  validate(value: string): string | undefined;
}): Promise<string | null> {
  const answer = await text({
    message: subtitledText(opts.message, opts.subtitle),
    placeholder: opts.placeholder,
    validate: (value) => opts.validate(value?.trim() ?? ""),
  });
  return isAborted(answer) ? null : String(answer).trim();
}

export async function runInteractive(
  ctx: WizardContext & {
    /** Ask the agent-wiring question (false under --no-connect). */
    connectEnabled: boolean;
    /** The repo already has a design folder — this run is adding a second one. */
    secondFolder?: boolean | undefined;
    /** Design-folder path already chosen by the caller — skips the prompt. */
    presetFolder?: string | undefined;
    /**
     * What a relative design-folder path resolves against — the directory init
     * was run in, which differs from `appRoot` when a nested app was picked.
     */
    folderBase?: string | undefined;
  },
): Promise<InteractiveOutcome> {
  // A second design folder in the same repo can't reuse the default name, and
  // "velloo-2" reads worse than a purpose name — suggest one they'll rename.
  const folderDefault = ctx.secondFolder ? "velloo-brand" : "velloo";
  const folderBase = ctx.folderBase ?? ctx.appRoot;
  // `velloo folder add <path>` already answered this — validate the path the
  // way the prompt would, so a bad one fails the same from either entry point.
  if (ctx.presetFolder) {
    const problem = folderPathProblem(resolve(folderBase, ctx.presetFolder), ctx.presetFolder);
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
        return folderPathProblem(resolve(folderBase, raw), raw);
      },
    }));
  if (isAborted(folderInput)) return cancelled();
  const folder = resolve(folderBase, folderInput || folderDefault);
  const root = await checkoutRoot(ctx.appRoot, folderBase);
  const local = !isWithin(root, folder);
  // Managed storage already said this when it was picked; a typed path that
  // lands outside the checkout is the case worth pointing out.
  if (local && !ctx.presetFolder)
    log.info(
      `${folder} is outside ${root}, so it will be a local design: recorded only on this machine, not in velloo.json, and not version-controlled by this repo.`,
    );

  // Agent wiring is asked up front (config before content) but only applied
  // after the scaffold is written — cancelling anywhere below touches no files.
  let agentWiring: AgentWiring | undefined;
  if (ctx.connectEnabled) {
    // Nothing is written yet, so predict the root `connect` will resolve once
    // the folder is registered.
    const wiring = await askAgentWiring({
      skipWhenCovered: true,
      projectRoot: root,
      globalOnly: local,
    });
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
    const desc = await promptBrief({
      message: "Component name or description",
      subtitle: "Whatever you'd call it in a code review — the agent finds it from this.",
      placeholder: "e.g. sidebar, pricing card, filter chip row",
      validate: (v) =>
        v ? undefined : "Describe the component so the agent knows what to redesign.",
    });
    if (desc === null) return cancelled();
    return outcome(
      await promptGoalWithAdoptedLibrary(hostCtx, folder, agentWiring, "component", {
        componentDescription: desc,
      }),
    );
  }
  if (goal === "custom") {
    const request = await promptBrief({
      message: "What design do you need?",
      subtitle: "A sentence is enough — it becomes the brief your agent works from.",
      placeholder: "e.g. a pricing page with three tiers and a FAQ",
      validate: (v) => (v ? undefined : "Describe what you want designed."),
    });
    if (request === null) return cancelled();
    return outcome(
      await promptGoalWithAdoptedLibrary(hostCtx, folder, agentWiring, "custom", {
        customRequest: request,
      }),
    );
  }
  if (goal === "capture-site") {
    const url = await promptBrief({
      message: "Site to design from",
      subtitle: "Init won't open it — your agent starts a capture session so you can log in first.",
      placeholder: "e.g. https://app.example.com/dashboard",
      validate(v) {
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
    if (url === null) return cancelled();
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
