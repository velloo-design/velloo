# @velloo/provider-antd

Ant Design v5 provider for Velloo — a first-class `FrameworkAdapter`.

- **Real antd components**, SSR'd in-process via a per-render `@ant-design/cssinjs`
  cache (`renderPass`); no client bundle needed.
- **Inline `style` channel** (`STYLE_PROP`) — antd has no `sx`; the theme runs in
  antd's `cssVar` mode so `--ant-*` variables reach inline styles.
- **Canvas-safe overlays**: antd's Modal/Drawer/Popover/Tooltip/Dropdown portal
  and SSR to nothing, so `overlays.ts` renders them open + inline.
- **Theme projection**: velloo tokens → antd `ThemeConfig` (`antdThemeConfig` for
  the runtime, `antdThemeOptions` for codegen — the dark algorithm emits as an
  `identifierRef`); `emit_theme` writes an `antd-theme.ts` module.
- **Codegen**: components emit as imports from `"antd"`. Dotted subcomponents
  (Typography.Title, List.Item) ride as flat ids (`TypographyTitle`, `ListItem`);
  the MCP intro tells the agent how they destructure.

`canvasBundleSpec` is deliberately absent in v1 — a cssinjs style runtime for the
canvas bundle means a new `CanvasStyleRuntime` union member plus a server
bundle-entry branch (see `src/index.ts`).
