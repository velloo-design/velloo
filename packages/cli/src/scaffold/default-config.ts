import type { Config } from "@velloo/schema";
import { snapshotVersion } from "@velloo/shadcn-snapshot";
import { TOOL_VERSION } from "../version.ts";

export function buildDefaultConfig(): Config {
  return {
    schemaVersion: 1,
    toolVersion: TOOL_VERSION,
    componentSource: {
      framework: "shadcn-react",
      snapshotVersion,
    },
    viewportPresets: [
      { name: "Mobile", w: 390, h: 844 },
      { name: "Tablet", w: 768, h: 1024 },
      { name: "Desktop", w: 1440, h: 900 },
    ],
  };
}
