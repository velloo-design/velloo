/**
 * Client charting libraries a host app might use. When `import_theme` finds one
 * in the app's package.json it tells the agent: register the app's chart
 * components as `render:"live"` extensions for fidelity — the built-in echarts
 * `Chart` is generic and won't pixel-match recharts/visx/etc. Scoped families
 * (`@visx/shape`, `@nivo/line`) match by their `@scope/` prefix and collapse to
 * the scope name.
 */
const CHART_LIBS = [
  "recharts",
  "echarts",
  "echarts-for-react",
  "chart.js",
  "react-chartjs-2",
  "victory",
  "plotly.js",
  "react-plotly.js",
  "@observablehq/plot",
  "@tremor/react",
  "react-vis",
  "d3",
  "@visx",
  "@nivo",
] as const;

/**
 * The chart libraries present among a merged dependency map (deps +
 * devDeps), as canonical ids — scoped families reported once by scope
 * (`@visx`, `@nivo`). Pure: no I/O.
 */
export function chartLibsInDeps(deps: Record<string, unknown>): string[] {
  const found = new Set<string>();
  for (const name of Object.keys(deps)) {
    for (const lib of CHART_LIBS) {
      if (name === lib || (lib.startsWith("@") && name.startsWith(`${lib}/`))) found.add(lib);
    }
  }
  return [...found].sort();
}
