import type { Config, Library } from "@velloo/schema";
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
   * Stable project id. Sprint X+1 will start writing one of these for
   * every new folder to key external-cache provider paths; today we
   * leave it optional so existing folders don't need rewriting.
   */
  projectId?: string;
}

export function buildDefaultConfig(opts: DefaultConfigOpts = {}): Config {
  return {
    schemaVersion: 1,
    toolVersion: TOOL_VERSION,
    library: opts.library ?? {
      id: "shadcn-react",
      version: snapshotVersion,
      // "binary" is the Sprint-X canonical source vocabulary: the
      // components live inside the velloo binary, not on disk in the
      // design folder. The migration shim in @velloo/server still
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
  };
}
