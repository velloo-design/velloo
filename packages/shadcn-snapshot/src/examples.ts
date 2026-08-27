/**
 * Canonical usage examples merged into the generated manifest by
 * build.ts. Only components whose prop *shapes* aren't obvious from
 * names need one — the goal is that an agent can copy the example,
 * swap values, and get a correct render on the first try.
 *
 * Covers the shadcn-sourced components only; the velloo helpers carry
 * their examples inside `@velloo/helpers`' canonical descriptors.
 */
export const COMPONENT_EXAMPLES: Record<string, Record<string, unknown>> = {
  Chart: {
    // Single series: `data: [{ x, y }]`. Multi-series: `categories` +
    // `series: [{ name, data: number[] }]` (legend auto-on). `kind`:
    // bar | line | area | pie | scatter. `tickFormat`: number | compact |
    // currency | percent. `xLabel`/`yLabel` add axis titles. `color`
    // (single-series): primary | accent | muted — theme tokens, so charts
    // flip under dark mode.
    kind: "bar",
    categories: ["Mon", "Tue", "Wed", "Thu", "Fri"],
    series: [
      { name: "Revenue", data: [4200, 5800, 5100, 7300, 6400] },
      { name: "Refunds", data: [400, 600, 350, 720, 500] },
    ],
    yLabel: "USD",
    tickFormat: "compact",
    className: "h-64 w-full",
  },
  Button: { variant: "outline", size: "sm", children: "Action" },
  Badge: { variant: "secondary", children: "Label" },
  Progress: { value: 64, className: "h-2" },
  Avatar: { className: "size-9" },
};
