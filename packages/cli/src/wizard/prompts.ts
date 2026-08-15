import { resolve } from "node:path";
import { cancel, isCancel, select, text } from "@clack/prompts";
import type { InitialContent, LibraryId, LibrarySource, WizardAnswers } from "./answers.ts";

/**
 * Bail out of the wizard if the user hit Esc/Ctrl-C on any prompt.
 * Returns `true` when the prompt was cancelled; callers should exit
 * after printing a cancellation notice.
 */
function isAborted(value: unknown): value is symbol {
  return isCancel(value);
}

function abort(): null {
  cancel("Cancelled — no files were written.");
  return null;
}

/**
 * Interactive prompts for `velloo init`. Walked sequentially so each
 * step can branch on previous answers (e.g. the "where do components
 * live" question only fires for shadcn).
 */
export async function runInteractive(defaults: { folder: string }): Promise<WizardAnswers | null> {
  const folder = await text({
    message: "Where should the design folder live?",
    placeholder: defaults.folder,
    defaultValue: defaults.folder,
    validate(value) {
      // Empty input is intentional — clack applies `defaultValue` after
      // validate runs, so rejecting "" here breaks "press Enter to accept
      // the placeholder". Only flag whitespace-only input.
      if (value && value.trim() === "") return "Path can't be empty.";
      return undefined;
    },
  });
  if (isAborted(folder)) return abort();

  const library = await select<LibraryId>({
    message: "Component library",
    options: [
      { value: "shadcn-react", label: "shadcn", hint: "React + Tailwind, recommended" },
      {
        value: "none",
        label: "No library",
        hint: "Box / Stack / Text primitives — Sprint X+2",
      },
      { value: "mui", label: "Material UI", hint: "MUI v6 — Sprint X+2" },
    ],
    initialValue: "shadcn-react",
  });
  if (isAborted(library)) return abort();

  let source: LibrarySource = "cache";
  if (library === "shadcn-react") {
    const picked = await select<LibrarySource>({
      message: "Where should the components live?",
      options: [
        {
          value: "in-repo",
          label: "In your app",
          hint: "<app>/src/components/ui — shared with your app code",
        },
        {
          value: "cache",
          label: "Velloo cache",
          hint: "~/.velloo/<projectId>/ — isolated from any app",
        },
        {
          value: "binary",
          label: "Bundled with velloo",
          hint: "No on-disk copy. The classic Pulse default.",
        },
      ],
      initialValue: "in-repo",
    });
    if (isAborted(picked)) return abort();
    source = picked;
  }

  let appPath: string | undefined;
  let componentsRelative = "src/components/ui";
  if (source === "in-repo") {
    const ap = await text({
      message: "Path to your app (the directory with package.json)",
      placeholder: "../apps/web",
      defaultValue: "../apps/web",
      validate(value) {
        if (value && value.trim() === "") return "Path can't be empty.";
        return undefined;
      },
    });
    if (isAborted(ap)) return abort();
    appPath = ap;

    const cr = await text({
      message: "Components subfolder inside your app",
      placeholder: "src/components/ui",
      defaultValue: "src/components/ui",
    });
    if (isAborted(cr)) return abort();
    if (cr) componentsRelative = cr;
  }

  const initialContent = await select<InitialContent>({
    message: "Initial design",
    options: [
      { value: "sample", label: "Pulse sample", hint: "7 screens, 3 boards" },
      {
        value: "scan",
        label: "Scan my app",
        hint: "one screen per route — Next.js / Vite / Astro detected",
      },
      { value: "blank", label: "Blank", hint: "Empty folder, no screens" },
    ],
    initialValue: "sample",
  });
  if (isAborted(initialContent)) return abort();

  const themeColor = await text({
    message: "Theme color (hex) — leave blank to skip",
    placeholder: "#7C3AED",
    defaultValue: "",
  });
  if (isAborted(themeColor)) return abort();

  const themeVibe = await select<string>({
    message: "Theme vibe — leave at 'skip' for the default Pulse indigo",
    options: [
      { value: "", label: "Skip" },
      { value: "calm", label: "Calm" },
      { value: "playful", label: "Playful" },
      { value: "professional", label: "Professional" },
      { value: "energetic", label: "Energetic" },
    ],
    initialValue: "",
  });
  if (isAborted(themeVibe)) return abort();

  return {
    folder: resolve(folder),
    library,
    source,
    appPath: appPath ? resolve(appPath) : undefined,
    componentsRelative,
    initialContent,
    themeColor: typeof themeColor === "string" && themeColor.trim() !== "" ? themeColor : undefined,
    themeVibe: typeof themeVibe === "string" && themeVibe !== "" ? themeVibe : undefined,
  };
}
