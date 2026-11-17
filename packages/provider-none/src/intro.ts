/**
 * MCP framing for a no-framework folder, one variant per style channel:
 * `*_INTRO` is the brief's paragraph (`FrameworkAdapter.mcpIntro`), `*_NOTES`
 * what `list_components` hands over with its index (`mcpNotes`).
 */
export const NONE_INTRO =
  "**This folder has no component library** — bare primitives (`Box`, `Stack`, `Card`, `Button`, `Input`, …) plus Velloo's helpers (`Heading`/`Text`, `Image`, `Icon`, …). Styling is **Tailwind classes**.";

export const NONE_INLINE_INTRO =
  "**This folder has no component library and no CSS framework** — bare primitives plus Velloo's helpers. **Style through inline `style` objects**, theme tokens as CSS variables (`var(--color-primary)`).";

const PRIMITIVES_STOP =
  "The primitives stop at `Box`/`Stack`/`Container`, `Card`, `Button`, `Input` and the helpers (`Heading`/`Text`, `Image`, `Gradient`, `Layer`, `SVG`, `Divider`, `Placeholder`, `Icon`): for a `Badge`/`Tabs`/`Dialog`, use the app's own component when a Repo shelf has one, else build it from primitives or a snippet.";

export const NONE_NOTES: readonly string[] = [PRIMITIVES_STOP];

export const NONE_INLINE_NOTES: readonly string[] = [
  PRIMITIVES_STOP,
  '`update_props { style: { display: "flex", gap: "16px", padding: "24px", color: "var(--color-foreground)" } }` takes a plain React style object: it merges shallowly, an inner `null` drops a key, `style: null` clears. Reference theme tokens as CSS variables from `get_theme` (`var(--color-primary)`, `var(--radius)`) so the design stays themable. `emit_code` emits `style={{…}}` on plain elements — no imports, no Tailwind — and Tailwind utility diagnostics do not apply.',
];
