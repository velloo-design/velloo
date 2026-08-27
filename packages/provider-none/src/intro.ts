/**
 * MCP instruction framing for the no-framework provider
 * (`FrameworkAdapter.mcpIntro`) — one variant per style channel: the Tailwind
 * channel keeps the base Tailwind guidance, the inline-`style` channel tells
 * the agent to ignore it.
 */
export const NONE_INTRO: readonly string[] = [
  'You are working on a **no-framework** Velloo design folder — bare primitives, no component library. Despite mentions of "shadcn" below, THIS folder has only `Box`/`Stack`/`Container` for layout, `Card`, `Button`, `Input`, plus the velloo helpers (`Heading`/`Text`, `Image`, `Gradient`, `Layer`, `SVG`, `Divider`, `Placeholder`, `Icon`) — all wrapping plain HTML, styled with **Tailwind classes**. Call `list_components` for the exact set: there is NO shadcn surface (no `Badge`/`Avatar`/`Tabs`/`Dialog`/etc.), so build those from primitives or define snippets. The Box/Card layout + Tailwind styling guidance below all applies.',
  "",
];

export const NONE_INLINE_INTRO: readonly string[] = [
  "You are working on a **no-framework** Velloo design folder with **no CSS framework** — bare primitives + velloo helpers (`Box`/`Stack`/`Container`, `Card`, `Button`, `Input`, `Heading`/`Text`, `Image`, `Icon`, `SVG`, `Divider`, `Gradient`, `Layer`, `Placeholder`) wrapping plain HTML, styled with **inline `style` objects** — there is no Tailwind here. Call `list_components` for the exact set; there is NO shadcn surface (no `Badge`/`Avatar`/`Tabs`/`Dialog`/etc.), so build those from primitives or snippets.",
  "",
  '**Style with the `style` object, not Tailwind classes.** Use `set_style { style: { display: "flex", gap: "16px", padding: "24px", borderRadius: "8px", color: "var(--color-foreground)" } }` — a plain React style object (merges shallowly; an inner `null` drops a key; `style: null` clears). Reference theme tokens as CSS variables (`var(--color-primary)`, `var(--color-muted-foreground)`, `var(--radius)`) from `get_theme` so the design stays themable. `emit_code` emits `style={{…}}` on plain elements (no imports, no Tailwind). **The Tailwind-specific guidance in the rest of these instructions — `className`, utility tokens (`bg-background`, `text-muted-foreground`) and the `audit` tool — does NOT apply here; ignore it.**',
  "",
];
