import { describe, expect, test } from "bun:test";
import { chartLibsInDeps } from "../chart-libs.ts";

describe("chartLibsInDeps", () => {
  test("flags known flat chart libs", () => {
    expect(chartLibsInDeps({ recharts: "^2.13.3", react: "^18" })).toEqual(["recharts"]);
    expect(chartLibsInDeps({ "chart.js": "^4", "react-chartjs-2": "^5" })).toEqual([
      "chart.js",
      "react-chartjs-2",
    ]);
  });

  test("collapses scoped families (@visx/*, @nivo/*) to the scope", () => {
    expect(
      chartLibsInDeps({ "@visx/shape": "^3", "@visx/scale": "^3", "@nivo/line": "^0.87" }),
    ).toEqual(["@nivo", "@visx"]);
  });

  test("returns sorted, deduped ids and ignores non-chart deps", () => {
    expect(
      chartLibsInDeps({ recharts: "1", echarts: "1", lodash: "1", "next-themes": "1" }),
    ).toEqual(["echarts", "recharts"]);
  });

  test("empty when no chart lib is present", () => {
    expect(chartLibsInDeps({ react: "^18", "react-dom": "^18", tailwindcss: "^4" })).toEqual([]);
  });
});
