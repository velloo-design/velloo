# Elsewhere welcome sample

The canonical design for `velloo init`: seven travel screens, the journey board
(including mobile and dark frames), and three tall agentic trip explorations.
The source was authored in `initial-board/` using Velloo. Preserve screen and
snippet IDs when bringing canvas edits back into this directory.

`elsewhere-sample.ts` includes these JSON documents, styles, image metadata and
local assets in the CLI bundle. `elsewhere-native.ts` recreates the same design
with actual MUI, Ant Design, Chakra, or no-library components. Composite controls
are rebuilt for each library; charts become editable SVGs where no chart adapter
exists. `elsewhere-styles.ts` translates the sample's authored layout utilities
and rejects unsupported additions so a design change cannot silently lose styling.

To refresh the design, copy the screens, snippets, boards (including notes), theme,
assets and assets.json from the authored design folder, then run the scaffold and
init tests and inspect native desktop/mobile and dark renders. Images are bundled
locally so new folders do not depend on a running demo server. See ASSET-SOURCES.md
for attribution and the distinction between seeded demo prompts and generated assets.
