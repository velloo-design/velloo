import type { Config } from "@velloo/schema";
import { TOOL_VERSION } from "../version.ts";

export function buildDefaultConfig(): Config {
  return {
    schemaVersion: 1,
    toolVersion: TOOL_VERSION,
    componentSource: {
      framework: "shadcn-react",
      // Sprint 2 lands the real shadcn snapshot; the lock-file shape is what matters here.
      snapshotVersion: "0.0.0-stub",
    },
    viewportPresets: [
      { name: "Mobile", w: 390, h: 844 },
      { name: "Tablet", w: 768, h: 1024 },
      { name: "Desktop", w: 1440, h: 900 },
    ],
  };
}
