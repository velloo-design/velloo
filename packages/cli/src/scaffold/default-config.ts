import type { Config, HostApp, Library } from "@velloo/schema";
import { snapshotVersion } from "@velloo/shadcn-snapshot";
import { TOOL_VERSION } from "../version.ts";

interface DefaultConfigOpts {
  /** Library declaration. Defaults to the embedded shadcn-react provider. */
  library?: Library;
  /** Default screen id to focus on first load. */
  defaultScreen?: string;
  /** Default board id to open on first load. */
  defaultBoard?: string;
  /**
   * Stable project id, used to key external-cache provider paths. Left
   * optional for now so existing folders don't need rewriting.
   */
  projectId?: string;
  /**
   * Host app location for the live-island bundler — set at init so
   * `render:"live"` extensions resolve against the user's app (their real
   * recharts &c.) without a manual config edit. See `HostApp`.
   */
  hostApp?: HostApp;
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
}

export function buildDefaultConfig(opts: DefaultConfigOpts = {}): Config {
  return {
    schemaVersion: 1,
    toolVersion: TOOL_VERSION,
    library: opts.library ?? {
      id: "shadcn-react",
      version: snapshotVersion,
      // "binary" is the canonical source vocabulary: the components
      // live inside the velloo binary, not on disk in the design
      // folder. The migration shim in @velloo/server still
      // accepts the legacy `"embedded:shadcn"` form for back-compat.
      source: "binary",
      componentsPath: "binary",
    },
    viewportPresets: [
      { name: "Mobile", w: 390, h: 844 },
      { name: "Tablet", w: 768, h: 1024 },
      { name: "Desktop", w: 1440, h: 900 },
    ],
    ...(opts.defaultScreen ? { defaultScreen: opts.defaultScreen } : {}),
    ...(opts.defaultBoard ? { defaultBoard: opts.defaultBoard } : {}),
    ...(opts.projectId ? { projectId: opts.projectId } : {}),
    ...(opts.hostApp ? { hostApp: opts.hostApp } : {}),
    ...(opts.feedback ? { feedback: opts.feedback } : {}),
    ...(opts.styling ? { styling: opts.styling } : {}),
  };
}
