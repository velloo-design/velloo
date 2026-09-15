# Elsewhere welcome sample

The canonical design for `velloo init`: seven travel screens, the journey board
(including mobile and dark frames), and three tall agentic trip explorations.
To edit it visually, generate the demos with `bun scripts/refresh-demo-boards.ts`,
open `demo-boards/shadcn-upstream/` on the canvas, then bring
the changes back into this directory — preserving screen and snippet IDs — before
`bun scripts/refresh-demo-boards.ts` overwrites that folder again.

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
