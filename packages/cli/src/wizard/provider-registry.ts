import { resolve } from "node:path";
import { MUI_VERSION } from "@velloo/provider-mui";
import { noLibVersion } from "@velloo/provider-none";
import type { Config, Library, Theme } from "@velloo/schema";
import { snapshotVersion } from "@velloo/shadcn-snapshot";
import { buildMuiBoards, buildMuiScreens, buildMuiSnippets } from "../scaffold/mui-sample.ts";
import {
  buildNoLibBoards,
  buildNoLibScreens,
  buildNoLibSnippets,
} from "../scaffold/nolib-sample.ts";
import { buildSampleBoards, buildSampleScreens } from "../scaffold/sample-page.ts";
import { buildSampleSnippets } from "../scaffold/sample-snippets.ts";
import type { Scaffold } from "../scaffold/scaffold.ts";
import type { DetectedHost, LibraryId, LibrarySource, WizardAnswers } from "./answers.ts";

export interface InstallPlan {
  /** Library config to persist to `.design/config.json`. */
  library: Library;
  /** Human-readable summary printed at the end of init. */
  summary: { name: string; location: string };
  /**
   * Set when the user chose shadcn-upstream: the real vanilla-shadcn install
   * is deferred to the post-init agent handoff so init never touches the
   * user's app. Carries where those components should land.
   */
  pendingUpstream?: { targetDir: string; relative: string };
}

/**
 * Everything the CLI knows about one component-library provider. Adding a
 * provider to the CLI means adding one entry to `WIZARD_PROVIDERS` — the
 * provider package itself and the server-side factory registration
 * (`packages/server/src/providers.ts`) live elsewhere. Every id-aware
 * wizard/init behavior — the interactive choice list, `--library`
 * validation, install planning, sample scaffolds, the styling axis, scan
 * adoption, and the README/handoff prose — derives from this table.
 */
export interface WizardProviderEntry {
  /** Label in the wizard's "Component library" select. */
  label: string;
  /** Hint line next to the label. */
  hint: string;
  /**
   * Offered in the interactive select? A false entry (MUI) stays reachable
   * via `--library` and scan detection only.
   */
  interactive: boolean;
  /** Sort position in the interactive select. */
  order: number;
  /**
   * LibrarySource a fresh folder records: "in-repo" when the real components
   * land in the user's app post-init, "binary" when the canvas renders from
   * a runtime bundled with velloo. (Scan adoption always forces "binary".)
   */
  defaultSource: LibrarySource;
  /** Ask where inside the app the upstream components should land. */
  asksComponentsSubfolder: boolean;
  /** Ask the theme preset / vibe question. */
  asksThemePreset: boolean;
  /** Ask the app-stack question (sets the codegen import alias). */
  asksStack: boolean;
  /**
   * Ships the Pulse product surfaces: drives the "What are you designing?"
   * prompt (providers without surfaces get the plain sample/blank pair) and
   * the `--surface` flag validation.
   */
  hasProductSurfaces: boolean;
  /** Placeholder-tree options for screens scaffolded from a scan. */
  scanScreenOpts: { hasBadge: boolean; mui: boolean };
  /** Resolve the wizard's answers into this provider's library declaration. */
  planInstall(answers: WizardAnswers): InstallPlan;
  /**
   * The provider's own sample scaffold, or undefined to ship the shadcn
   * Pulse default (see `sampleScaffold`).
   */
  buildSampleScaffold(theme: Theme, answers: WizardAnswers): Scaffold | undefined;
  /**
   * `config.styling` for a fresh folder — only the no-framework provider has
   * a real CSS-framework choice; single-channel providers return undefined.
   */
  stylingFor(answers: WizardAnswers): Config["styling"];
  /** Scan adoption: claims a detected host when the user didn't pin `--library`. */
  scanMatch?: (detected: DetectedHost) => boolean;
  /** Console note printed when `scanMatch` adopts this provider. */
  scanNote?: (detected: DetectedHost) => string;
  /** How the agent handoff names the components ("the project's X components"). */
  handoffComponentsLabel: string;
  /** The design-folder README's per-provider components section. */
  readmeComponentsSection(plan: InstallPlan): string[];
}

/** README section for providers whose components ship inside the velloo binary. */
function bundledComponentsSection(): string[] {
  return [
    "## Bundled components",
    "",
    "The shadcn snapshot lives inside the velloo binary. No files were",
    "written to your app. When you're ready to bring shadcn into your",
    "project, run `npx shadcn@latest init` there separately, then",
    "`velloo theme:export <app>` to align the theme.",
    "",
  ];
}

export const WIZARD_PROVIDERS: Record<LibraryId, WizardProviderEntry> = {
  "shadcn-upstream": {
    label: "shadcn",
    hint: "Vanilla shadcn added to your app. Recommended.",
    interactive: true,
    order: 0,
    defaultSource: "in-repo",
    asksComponentsSubfolder: true,
    asksThemePreset: true,
    asksStack: true,
    hasProductSurfaces: true,
    scanScreenOpts: { hasBadge: true, mui: false },
    planInstall(answers) {
      const library: Library = {
        id: "shadcn-upstream",
        version: snapshotVersion,
        source: "binary",
        componentsPath: "binary",
      };
      const targetDir = resolve(answers.appRoot, answers.componentsRelative);
      return {
        library,
        summary: {
          name: "shadcn (upstream)",
          location: `canvas uses the bundled snapshot; real components added to ${answers.componentsRelative} on setup`,
        },
        pendingUpstream: { targetDir, relative: answers.componentsRelative },
      };
    },
    // Pulse is shadcn-native — the shared default in `sampleScaffold` carries it.
    buildSampleScaffold: () => undefined,
    stylingFor: () => undefined,
    scanMatch: (detected) => detected.uiLibrary === "shadcn",
    scanNote: (detected) => `Detected ${detected.uiLibrary} — using that library.`,
    handoffComponentsLabel: "shadcn",
    readmeComponentsSection: (plan) =>
      plan.pendingUpstream
        ? [
            "## Bringing shadcn into your app",
            "",
            "Init did not write anything into your app. The canvas renders against",
            "the bundled shadcn snapshot; when you're ready to land real vanilla",
            `shadcn into your app at \`${plan.pendingUpstream.relative}\`, ask your AI`,
            "agent (it was wired up during init) to finish setup — or run",
            "`npx shadcn@latest add <component>` yourself. Then",
            "`velloo theme:export <app>` aligns the theme.",
            "",
          ]
        : bundledComponentsSection(),
  },
  none: {
    label: "No library",
    hint: "Box / Stack / Text primitives.",
    interactive: true,
    order: 1,
    defaultSource: "binary",
    asksComponentsSubfolder: false,
    asksThemePreset: false,
    asksStack: false,
    hasProductSurfaces: false,
    scanScreenOpts: { hasBadge: false, mui: false },
    planInstall: () => ({
      library: { id: "none", version: noLibVersion, source: "binary", componentsPath: "binary" },
      summary: {
        name: `no-library primitives (${noLibVersion})`,
        location: "bundled with velloo",
      },
    }),
    // No-library Pulse doesn't exist (Avatar / Tabs / Accordion / Chart have
    // no no-lib equivalents) — a smaller two-screen welcome sample instead.
    buildSampleScaffold: (theme) => ({
      theme,
      screens: buildNoLibScreens(),
      boards: buildNoLibBoards(),
      snippets: buildNoLibSnippets(),
      annotations: [],
      notes: [],
    }),
    // The one provider with a real CSS-framework choice: detect Tailwind in
    // the host (config/dep) ⇒ "tailwind", otherwise ⇒ "none" (inline styles,
    // no build step).
    stylingFor: (answers) => ({
      framework: answers.detected?.tailwindMajor ? "tailwind" : "none",
    }),
    // An unsupported framework (Chakra/Mantine/…) → the no-framework adapter:
    // the agent approximates with div-backed primitives + preserves real
    // imports via $emitAs.
    scanMatch: (detected) => Boolean(detected.unsupportedUi),
    scanNote: (detected) =>
      `Detected ${detected.unsupportedUi} (no velloo adapter yet) — using the no-framework adapter; approximate its components and preserve their imports with emit-as.`,
    handoffComponentsLabel: "velloo primitive",
    readmeComponentsSection: () => bundledComponentsSection(),
  },
  mui: {
    label: "Material UI",
    hint: "Real @mui/material, sx styling.",
    // Not offered in the wizard select — reachable via --library=mui and
    // scan detection of a MUI host only.
    interactive: false,
    order: 2,
    defaultSource: "binary",
    asksComponentsSubfolder: false,
    asksThemePreset: false,
    asksStack: false,
    hasProductSurfaces: false,
    scanScreenOpts: { hasBadge: true, mui: true },
    // Framework-native: MUI is a first-class adapter bundled with velloo
    // (@mui/material + emotion are velloo deps; components SSR in-process).
    planInstall: () => ({
      library: { id: "mui", version: MUI_VERSION, source: "binary", componentsPath: "binary" },
      summary: { name: `Material UI v${MUI_VERSION}`, location: "bundled with velloo" },
    }),
    // Pulse isn't ported to MUI (its shadcn composition would need a full
    // redesign) — a two-screen MUI welcome sample (sx styling) instead.
    buildSampleScaffold: (theme) => ({
      theme,
      screens: buildMuiScreens(),
      boards: buildMuiBoards(),
      snippets: buildMuiSnippets(),
      annotations: [],
      notes: [],
    }),
    stylingFor: () => undefined,
    scanMatch: (detected) => detected.uiLibrary === "mui",
    scanNote: (detected) => `Detected ${detected.uiLibrary} — using that library.`,
    handoffComponentsLabel: "Material UI",
    readmeComponentsSection: () => [
      "## Material UI in your app",
      "",
      "The canvas renders **real Material UI** components (bundled with velloo,",
      "emotion-rendered) — no files were written to your app. When you implement",
      "a screen, `emit_code` emits idiomatic MUI (`sx` props + `@mui/material`",
      "imports) and `emit_theme` emits a `createTheme(...)` module. For that code",
      "to build, install the runtime deps in your app:",
      "",
      "```bash",
      "npm install @mui/material @emotion/react @emotion/styled",
      "```",
      "",
      "Once installed, velloo can also client-render the canvas against your",
      "app's exact MUI version. Style nodes with the `sx` editor (canvas) or",
      "`set_style` (agent).",
      "",
    ],
  },
};

/**
 * Registry ids in declaration order — drives `--library` validation and any
 * prose that lists the valid ids, so the two can't drift.
 */
export const LIBRARY_IDS = Object.keys(WIZARD_PROVIDERS) as LibraryId[];

export const DEFAULT_LIBRARY_ID: LibraryId = "shadcn-upstream";

/** Choice list for the wizard's "Component library" select. */
export function interactiveLibraryChoices(): { value: LibraryId; label: string; hint: string }[] {
  return LIBRARY_IDS.filter((id) => WIZARD_PROVIDERS[id].interactive)
    .sort((a, b) => WIZARD_PROVIDERS[a].order - WIZARD_PROVIDERS[b].order)
    .map((id) => ({
      value: id,
      label: WIZARD_PROVIDERS[id].label,
      hint: WIZARD_PROVIDERS[id].hint,
    }));
}

/**
 * Resolve the wizard's answers into a library declaration. Init is
 * **non-destructive**: it writes nothing into the user's app and copies no
 * components to disk. Every fresh folder renders from the snapshot baked
 * into the binary (`source: "binary"`); for shadcn-upstream the intended
 * in-app component location is recorded as `pendingUpstream` and the actual
 * fetch is left to the post-init agent step. Canvas-fork files never leave
 * the velloo package.
 */
export function planInstall(answers: WizardAnswers): InstallPlan {
  return WIZARD_PROVIDERS[answers.library].planInstall(answers);
}

/**
 * The provider's sample scaffold; providers without one of their own
 * (shadcn-upstream) fall back to the Pulse sample, optionally sliced by
 * product surface.
 */
export function sampleScaffold(answers: WizardAnswers, theme: Theme): Scaffold {
  return (
    WIZARD_PROVIDERS[answers.library].buildSampleScaffold(theme, answers) ?? {
      theme,
      screens: buildSampleScreens(answers.productSurface),
      boards: buildSampleBoards(answers.productSurface),
      snippets: buildSampleSnippets(),
      annotations: [],
      notes: [],
    }
  );
}

/**
 * The "existing project" flow: when the user didn't pin `--library`, adopt
 * the provider whose `scanMatch` claims the detected host so the scan renders
 * + emits in the host's framework, not a default mismatch. Returns the
 * adopted id plus the console note to print, or undefined when no provider
 * claims the host.
 */
export function scanAdoption(
  detected: DetectedHost,
): { library: LibraryId; note: string } | undefined {
  for (const id of LIBRARY_IDS) {
    const entry = WIZARD_PROVIDERS[id];
    if (entry.scanMatch?.(detected)) {
      return { library: id, note: entry.scanNote?.(detected) ?? "" };
    }
  }
  return undefined;
}
