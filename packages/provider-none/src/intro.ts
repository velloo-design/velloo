/**
 * MCP instruction framing for a no-framework folder
 * (`FrameworkAdapter.mcpIntro`), one variant per style channel.
 *
 * The server's base brief is framework-neutral, so these state the (small)
 * vocabulary positively rather than correcting a shadcn claim.
 */
export const NONE_INTRO: readonly string[] = [
  "**This folder has no component library** — only bare primitives wrapping plain HTML: `Box`/`Stack`/`Container` for layout, `Card`, `Button`, `Input`, plus the velloo helpers (`Heading`/`Text`, `Image`, `Gradient`, `Layer`, `SVG`, `Divider`, `Placeholder`, `Icon`). The primitives stop there: for a `Badge`/`Tabs`/`Dialog`, use the app's own component when `list_components` shows one on a Repo shelf, else build it from primitives or a snippet. Call `list_components` for the exact set. Styling is **Tailwind classes**.",
  "",
];

export const NONE_INLINE_INTRO: readonly string[] = [
  "**This folder has no component library and no CSS framework** — bare primitives wrapping plain HTML (`Box`/`Stack`/`Container`, `Card`, `Button`, `Input`) plus the velloo helpers (`Heading`/`Text`, `Image`, `Icon`, `SVG`, `Divider`, `Gradient`, `Layer`, `Placeholder`). The primitives stop there: for a `Badge`/`Tabs`/`Dialog`, use the app's own component when `list_components` shows one on a Repo shelf, else build it from primitives or a snippet. Call `list_components` for the exact set.",
  "",
  '**Style through inline `style` objects.** `update_props { style: { display: "flex", gap: "16px", padding: "24px", borderRadius: "8px", color: "var(--color-foreground)" } }` — a plain React style object (merges shallowly; an inner `null` drops a key, `style: null` clears). Reference theme tokens as CSS variables (`var(--color-primary)`, `var(--radius)`) from `get_theme` so the design stays themable. `emit_code` emits `style={{…}}` on plain elements — no imports, no Tailwind. Tailwind utility diagnostics do not apply.',
  "",
];
