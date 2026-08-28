import { type Config, CURRENT_SCHEMA_VERSION, type HostApp, type Library } from "@velloo/schema";
import { snapshotVersion } from "@velloo/shadcn-snapshot/version";
import { TOOL_VERSION } from "../version.ts";

interface DefaultConfigOpts {
  /** Library declaration. Defaults to shadcn-upstream on the snapshot runtime. */
  library?: Library;
  /** Default screen id to focus on first load. */
  defaultScreen?: string;
  /** Default board id to open on first load. */
  defaultBoard?: string;
  /**
   * Host app location for the live-island bundler — set at init so
   * `render:"live"` extensions resolve against the user's app (their real
   * recharts &c.) without a manual config edit. See `HostApp`.
   */
  hostApp?: HostApp;
  /**
   * Named host apps for a monorepo scan — one entry per route-bearing app,
   * keyed by the same short prefix the scan used for screen ids ("web",
   * "admin"), so `extension.app` can route a live island to the right app.
   */
  hostApps?: Record<string, HostApp>;
  /**
   * Opt-in product feedback, captured by the interactive wizard after the
   * user signs in. Absent ⇒ feedback stays off (the default).
   */
  feedback?: { enabled: boolean; contactOk?: boolean };
  /**
   * The folder's CSS framework (the styling axis). Set only for the
   * no-framework library — shadcn carries Tailwind and MUI carries `sx`, so
   * their channel is intrinsic and `styling` stays absent.
   */
  styling?: Config["styling"];
  /**
   * Codegen defaults — set when the wizard's stack prompt picked an import
   * alias. Absent ⇒ codegen falls back to `@/components/ui`.
   */
  codegen?: Config["codegen"];
}

export function buildDefaultConfig(opts: DefaultConfigOpts = {}): Config {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    toolVersion: TOOL_VERSION,
    // Stable cloud identity: share links carry it server-side, so any clone
    // of the folder finds its published links (and their comments) by id.
    folderId: crypto.randomUUID(),
    libraries: {
      default: opts.library ?? {
        id: "shadcn-upstream",
        version: snapshotVersion,
        // "binary": the canvas renders from the snapshot runtime inside
        // the velloo binary; real components install into the app later.
        source: "binary",
        componentsPath: "binary",
      },
    },
    defaultLibrary: "default",
    viewportPresets: [
      { name: "Mobile", w: 390, h: 844 },
      { name: "Tablet", w: 768, h: 1024 },
      { name: "Desktop", w: 1440, h: 900 },
    ],
    ...(opts.defaultScreen ? { defaultScreen: opts.defaultScreen } : {}),
    ...(opts.defaultBoard ? { defaultBoard: opts.defaultBoard } : {}),
    ...(opts.hostApp ? { hostApp: opts.hostApp } : {}),
    ...(opts.hostApps ? { hostApps: opts.hostApps } : {}),
    ...(opts.feedback ? { feedback: opts.feedback } : {}),
    ...(opts.styling ? { styling: opts.styling } : {}),
    ...(opts.codegen ? { codegen: opts.codegen } : {}),
  };
}
