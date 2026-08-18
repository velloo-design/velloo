export { findScanRoot, type ResolvedScanRoot, resolveScanRoot } from "./discover.ts";
export { buildBoardFromScan, buildScreensFromScan } from "./generate-screens.ts";
export { looksLikeReactApp, scanAppRoutes } from "./routes.ts";
export type { Framework, ScannedRoute, ScanResult } from "./types.ts";
