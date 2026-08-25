export { type DiscoveredApp, discoverScanRoots, findScanRoot } from "./discover.ts";
export { buildBoardsFromScan, buildScreensFromScan } from "./generate-screens.ts";
export { looksLikeUiApp, scanAppRoutes } from "./routes.ts";
export { type AppsScanResult, appPrefixes, primaryApp, scanApps } from "./scan-apps.ts";
export type { AppScan, Framework, ScannedRoute, ScanResult } from "./types.ts";
