/**
 * MCP instruction framing for a no-framework folder
 * (`FrameworkAdapter.mcpIntro`), one variant per style channel.
 *
 * The server's base brief is framework-neutral, so these state the (small)
 * vocabulary positively rather than correcting a shadcn claim.
 */
export const NONE_INTRO: readonly string[] = [
  "**This folder has no component library** — only bare primitives wrapping plain HTML: `Box`/`Stack`/`Container` for layout, `Card`, `Button`, `Input`, plus the velloo helpers (`Heading`/`Text`, `Image`, `Gradient`, `Layer`, `SVG`, `Divider`, `Placeholder`, `Icon`). There is no `Badge`/`Avatar`/`Tabs`/`Dialog` — build those from primitives or define snippets. Call `list_components` for the exact set. Styling is **Tailwind classes**.",
  "",
];

export const NONE_INLINE_INTRO: readonly string[] = [
  "**This folder has no component library and no CSS framework** — bare primitives wrapping plain HTML (`Box`/`Stack`/`Container`, `Card`, `Button`, `Input`) plus the velloo helpers (`Heading`/`Text`, `Image`, `Icon`, `SVG`, `Divider`, `Gradient`, `Layer`, `Placeholder`). There is no `Badge`/`Avatar`/`Tabs`/`Dialog` — build those from primitives or snippets. Call `list_components` for the exact set.",
  "",
  '**Style through inline `style` objects.** `update_props { style: { display: "flex", gap: "16px", padding: "24px", borderRadius: "8px", color: "var(--color-foreground)" } }` — a plain React style object (merges shallowly; an inner `null` drops a key, `style: null` clears). Reference theme tokens as CSS variables (`var(--color-primary)`, `var(--radius)`) from `get_theme` so the design stays themable. `emit_code` emits `style={{…}}` on plain elements — no imports, no Tailwind. There is no Tailwind here, so utility classes and the `audit` tool do not apply.',
  "",
];
