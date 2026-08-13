import type { Config } from "@velloo/schema";
import { snapshotVersion } from "@velloo/shadcn-snapshot";
import { TOOL_VERSION } from "../version.ts";

export function buildDefaultConfig(): Config {
  return {
    schemaVersion: 1,
    toolVersion: TOOL_VERSION,
    library: {
      id: "shadcn-react",
      version: snapshotVersion,
      source: "registry:shadcn",
      componentsPath: "components",
    },
    viewportPresets: [
      { name: "Mobile", w: 390, h: 844 },
      { name: "Tablet", w: 768, h: 1024 },
      { name: "Desktop", w: 1440, h: 900 },
    ],
    defaultScreen: "welcome",
  };
}
