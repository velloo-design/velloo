import { dirname, relative, resolve } from "node:path";
// Version-only subpath imports: pulling these from the provider indexes would
// drag every framework registry into the CLI's eager bundle graph — the whole
// point of the lazy provider chunks (see packages/server/src/providers.ts).
import { ANTD_VERSION } from "@velloo/provider-antd/version";
import { CHAKRA_VERSION } from "@velloo/provider-chakra/version";
import { MUI_VERSION } from "@velloo/provider-mui/version";
import { noLibVersion } from "@velloo/provider-none/version";
import type { Config, Library, Theme } from "@velloo/schema";
import { snapshotVersion } from "@velloo/shadcn-snapshot/version";
import { buildElsewhereScaffold } from "../scaffold/elsewhere-sample.ts";
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
  /** Placeholder-tree options for screens scaffolded from a scan. */
  scanScreenOpts: { hasBadge: boolean; tree?: "mui" | "antd" | "chakra" | undefined };
  /** Resolve the wizard's answers into this provider's library declaration. */
  planInstall(answers: WizardAnswers): InstallPlan;
  /**
   * The complete Elsewhere sample composed for this provider.
   */
  buildSampleScaffold(theme: Theme, answers: WizardAnswers): Scaffold;
  /**
   * `config.styling` for a fresh folder — only the no-framework provider has
   * a real CSS-framework choice; single-channel providers return undefined.
   */
  stylingFor(answers: WizardAnswers): Config["styling"];
  /** Scan adoption: claims a detected host when the user didn't pin `--library`. */
  scanMatch?: ((detected: DetectedHost) => boolean) | undefined;
  /** Console note printed when `scanMatch` adopts this provider. */
  scanNote?: ((detected: DetectedHost) => string) | undefined;
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
    hint: "Real shadcn, Tailwind classes. Recommended.",
    interactive: true,
    order: 0,
    defaultSource: "in-repo",
    asksComponentsSubfolder: true,
    scanScreenOpts: { hasBadge: true },
    planInstall(answers) {
      const targetDir = resolve(answers.appRoot, answers.componentsRelative);
      const library: Library = {
        id: "shadcn-upstream",
        version: snapshotVersion,
        source: "in-repo",
        // The provider expects a root containing `ui/`; store it relative to
        // the design folder so a cloned repo remains portable.
        componentsPath: relative(answers.folder, dirname(targetDir)) || ".",
      };
      return {
        library,
        summary: {
          name: "shadcn (upstream)",
          location: `canvas reads client-safe components from ${answers.componentsRelative}; canvas-safe fallbacks cover missing or unsupported files`,
        },
        pendingUpstream: { targetDir, relative: answers.componentsRelative },
      };
    },
    // The canonical design uses shadcn; other providers rebuild native controls.
    buildSampleScaffold: (theme) => buildElsewhereScaffold("shadcn-upstream", theme),
    stylingFor: () => undefined,
    scanMatch: (detected) => detected.uiLibrary === "shadcn",
    scanNote: (detected) => `Detected ${detected.uiLibrary} — using that library.`,
    handoffComponentsLabel: "shadcn",
    readmeComponentsSection: (plan) =>
      plan.pendingUpstream
        ? [
            "## Bringing shadcn into your app",
            "",
            "Init did not write anything into your app. To add shadcn at",
            `\`${plan.pendingUpstream.relative}\`, ask your AI`,
            "agent (it was wired up during init) to finish setup — or run",
            "`npx shadcn@latest add <component>` yourself. Client-safe files render",
            "directly from the repo; overlays use labeled canvas adaptations and",
            "broken or missing files visibly fall back to Velloo's snapshot. Then",
            "`velloo theme:export <app>` aligns the theme.",
            "",
          ]
        : bundledComponentsSection(),
  },
  none: {
    label: "No library",
    hint: "Plain Box / Stack / Text primitives.",
    interactive: true,
    // Last in the list: the deliberate trivial-end choice, not a default.
    order: 9,
    defaultSource: "binary",
    asksComponentsSubfolder: false,
    scanScreenOpts: { hasBadge: false },
    planInstall: () => ({
      library: { id: "none", version: noLibVersion, source: "binary", componentsPath: "binary" },
      summary: {
        name: `no-library primitives (${noLibVersion})`,
        location: "bundled with velloo",
      },
    }),
    buildSampleScaffold: (theme) => buildElsewhereScaffold("none", theme),
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
    order: 4,
    defaultSource: "binary",
    asksComponentsSubfolder: false,
    scanScreenOpts: { hasBadge: true, tree: "mui" },
    // Framework-native: MUI is a first-class adapter bundled with velloo
    // (@mui/material + emotion are velloo deps; components SSR in-process).
    planInstall: () => ({
      library: { id: "mui", version: MUI_VERSION, source: "binary", componentsPath: "binary" },
      summary: { name: `Material UI v${MUI_VERSION}`, location: "bundled with velloo" },
    }),
    buildSampleScaffold: (theme) => buildElsewhereScaffold("mui", theme),
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
      "`update_props`'s `style` (agent).",
      "",
    ],
  },
  antd: {
    label: "Ant Design",
    hint: "Real antd v5, inline style objects.",
    interactive: true,
    order: 2,
    defaultSource: "binary",
    asksComponentsSubfolder: false,
    scanScreenOpts: { hasBadge: true, tree: "antd" },
    // Framework-native like MUI: antd is a first-class adapter bundled with
    // velloo (antd + @ant-design/cssinjs are velloo deps; components SSR
    // in-process).
    planInstall: () => ({
      library: { id: "antd", version: ANTD_VERSION, source: "binary", componentsPath: "binary" },
      summary: { name: `Ant Design v${ANTD_VERSION}`, location: "bundled with velloo" },
    }),
    buildSampleScaffold: (theme) => buildElsewhereScaffold("antd", theme),
    stylingFor: () => undefined,
    scanMatch: (detected) => detected.uiLibrary === "antd",
    scanNote: (detected) => `Detected ${detected.uiLibrary} — using that library.`,
    handoffComponentsLabel: "Ant Design",
    readmeComponentsSection: () => [
      "## Ant Design in your app",
      "",
      "The canvas renders **real Ant Design** components (bundled with velloo,",
      "cssinjs-rendered) — no files were written to your app. When you implement",
      "a screen, `emit_code` emits idiomatic antd (inline `style` objects +",
      "`antd` imports) and `emit_theme` emits a ConfigProvider `ThemeConfig`",
      "module. For that code to build, install the runtime dep in your app:",
      "",
      "```bash",
      "npm install antd",
      "```",
      "",
      "Style nodes with the inline-style editor (canvas) or `update_props`'s `style` (agent).",
      "",
    ],
  },
  chakra: {
    label: "Chakra UI",
    hint: "Real Chakra v2, sx styling.",
    interactive: true,
    order: 3,
    defaultSource: "binary",
    asksComponentsSubfolder: false,
    scanScreenOpts: { hasBadge: true, tree: "chakra" },
    // Framework-native like MUI: chakra is a first-class adapter bundled with
    // velloo (@chakra-ui/react + emotion are velloo deps; components SSR
    // in-process).
    planInstall: () => ({
      library: {
        id: "chakra",
        version: CHAKRA_VERSION,
        source: "binary",
        componentsPath: "binary",
      },
      summary: { name: `Chakra UI v${CHAKRA_VERSION}`, location: "bundled with velloo" },
    }),
    buildSampleScaffold: (theme) => buildElsewhereScaffold("chakra", theme),
    stylingFor: () => undefined,
    scanMatch: (detected) => detected.uiLibrary === "chakra",
    scanNote: (detected) => `Detected ${detected.uiLibrary} — using that library.`,
    handoffComponentsLabel: "Chakra UI",
    readmeComponentsSection: () => [
      "## Chakra UI in your app",
      "",
      "The canvas renders **real Chakra UI v2** components (bundled with velloo,",
      "emotion-rendered) — no files were written to your app. When you implement",
      "a screen, `emit_code` emits idiomatic chakra (`sx` props +",
      "`@chakra-ui/react` imports) and `emit_theme` emits an `extendTheme(...)`",
      "module. For that code to build, install the runtime deps in your app:",
      "",
      "```bash",
      "npm install @chakra-ui/react@2 @emotion/react @emotion/styled framer-motion",
      "```",
      "",
      "Style nodes with the `sx` editor (canvas) or `update_props`'s `style` (agent).",
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
 * components to disk. shadcn records the intended in-repo location immediately
 * so the canvas can start rendering those files as soon as the agent or user
 * installs them; the snapshot remains a labeled fallback. Canvas-fork files
 * never leave the velloo package.
 */
export function planInstall(answers: WizardAnswers): InstallPlan {
  return WIZARD_PROVIDERS[answers.library].planInstall(answers);
}

/**
 * The provider's sample scaffold; providers without one of their own
 * (shadcn-upstream) fall back to the full welcome sample.
 */
export function sampleScaffold(answers: WizardAnswers, theme: Theme): Scaffold {
  return WIZARD_PROVIDERS[answers.library].buildSampleScaffold(theme, answers);
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
