/**
 * Canonical usage examples merged into the generated manifest by
 * build.ts. Only components whose prop *shapes* aren't obvious from
 * names need one — the goal is that an agent can copy the example,
 * swap values, and get a correct render on the first try.
 */
export const COMPONENT_EXAMPLES: Record<string, Record<string, unknown>> = {
  Box: { className: "flex flex-col gap-6 px-8 py-12" },
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
  Image: {
    src: "/assets/hero.png",
    aspect: "16/9",
    focal: { x: 0.5, y: 0.35 },
    treatment: "overlay-dark",
    className: "rounded-xl",
  },
  Gradient: {
    preset: "dusk",
    direction: "br",
    className: "absolute inset-0 -z-0 pointer-events-none",
  },
  Icon: { name: "Sparkles", className: "size-4 text-primary" },
  Placeholder: { kind: "image", aspect: "16/9", label: "product screenshot" },
  Divider: { variant: "gradient", color: "primary", label: "OR" },
  Layer: { top: 16, left: 16, z: 2 },
  SVG: {
    content: "<path d='M12 2 2 7l10 5 10-5-10-5z' />",
    viewBox: "0 0 24 24",
    color: "primary",
    className: "h-8 w-8",
  },
  Heading: { level: 2, children: "Section title", className: "text-3xl font-semibold" },
  Text: { variant: "muted", children: "Supporting copy." },
  Button: { variant: "outline", size: "sm", children: "Action" },
  Badge: { variant: "secondary", children: "Label" },
  Progress: { value: 64, className: "h-2" },
  Avatar: { className: "size-9" },
};
