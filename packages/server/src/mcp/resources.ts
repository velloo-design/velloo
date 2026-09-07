import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Long-form guides, served as MCP resources rather than tool descriptions.
 *
 * The prose here is the same hard-won guidance that used to live inline on
 * `add_extension`, `compare_to_url`, `import_theme`, `add_snippet` and the
 * boot instructions — several thousand tokens that every session paid for
 * whether or not it ever touched those tools. A resource is fetched on demand,
 * so the resident cost drops to one listing line each.
 *
 * The rule for what belongs where: a tool's `description` says WHAT it does and
 * WHEN to reach for it, in one or two sentences, and names its guide. The guide
 * carries the rest — parameter semantics beyond the schema, failure modes,
 * worked examples, and the judgement calls that only matter once you are
 * actually doing the thing.
 */

interface Guide {
  /** Human title, shown in the resource listing. */
  title: string;
  /** One line — this is what a session pays for at boot, so keep it short. */
  blurb: string;
  body: string;
}

const GUIDES: Record<string, Guide> = {
  snippets: {
    title: "Snippets",
    blurb: "Params, node slots, $if branching, and when to reuse vs inline.",
    body: `# Snippets

A snippet is a named, reusable subtree with typed params. Create it once with \`add_snippet\`, then place its PascalCase name with \`compose\` like any other JSX tag. Snippets emit as real React components on \`emit_code\`, with a typed \`className?: string\` prop.

## Param placement

\`params\` declares typed inputs; placeholders inside the body are \`{ "$param": "name" }\` refs substituted at render time. **Placement depends on the param type:**

- A \`node\` param fills a child slot — put \`{"$param":"slot"}\` directly in a \`children\` array.
- A scalar param (string/number/boolean/icon/color/enum) fills a prop value — put \`{"$param":"title"}\` as a prop:
  \`{"$ref":"Heading","props":{"children":{"$param":"title"}}}\`

A scalar \`$param\` placed directly in a \`children\` array is an error — it renders as nothing.

## Structural variance is not a reason to inline

**If the STRUCTURE varies between instances, that is still one snippet — declare a \`node\` param.** Rows whose leading mark is an icon, or a logo, or nothing at all are three fillings of one \`node\` slot: not three snippets, and not a reason to inline the repetition.

Add \`optional: true\` and an omitted slot renders and emits nothing, so the "or nothing at all" case needs no placeholder. A \`node\` param accepts one node or an array that renders as siblings.

Only scalar values belong in scalar params. Notably an \`icon\` param bakes ONE lucide glyph into the emitted JSX for every instance, so a per-instance icon must be a \`node\` param.

Inlining repeated structure instead of parameterizing it is the most common and most expensive mistake here — it bloats the screen JSON and turns every later edit into N edits.

## Variation axes

- \`{"$if": "paramName", "then": <value>, "else": <value>}\` — picks a branch by truthiness of \`args.paramName\`. **Boolean params only.** Non-boolean truthy values "work" via JS coercion but you will trip on edge cases (empty string is falsy, the string \`"false"\` is truthy). Declare these params as \`type: "boolean"\`.
- String params (\`tone\`, \`variant\`) for full-className swaps when the variation is more than two-way.
- \`type: "node"\` params when the structure varies per instance.
- \`className\` on a snippet tag (or \`update_snippet_instance\`) — a one-off Tailwind suffix appended to the body root. Cascades through nested snippet roots.

## Verify every new definition

**Always call \`render_snippet\` after \`add_snippet\`.** \`$param\` wiring bugs — placeholder did not expand, gradient missing, \`$if\` truthy-coerced wrong — are silent at definition time and only surface at instantiation. Preview before stamping.

## Editing

- One node in ONE instance ("this card's badge is red") → \`update_snippet_instance { path, innerPath, propPatch }\`.
- One node across ALL instances → \`update_snippet { patch: { innerPatch: { innerPath, propPatch } } }\` — no need to resend the body.
- Replace the whole body → \`update_snippet { patch: { tree } }\`.
- Change one instance's inputs → \`update_snippet_instance { path, argPatch }\`.

Reference a snippet by its PascalCase tag from \`list_components\`: \`<SiteHeader title="…" />\`. The restricted JSX compiler resolves the persisted kebab id automatically and validates its params before writing.`,
  },

  components: {
    title: "Component vocabulary",
    blurb: "Shelves, reaching for a family vs a Box stack, children, icons, raw CSS.",
    body: `# Component vocabulary

## Reading the catalog

\`list_components\` returns *families* on shelves, not a flat list of names. Each shelf says what its components are for; each family lists the \`pieces\` you compose inside it.

| Shelf | What lives there |
| --- | --- |
| Actions | Button, ButtonGroup, Toggle |
| Forms & Inputs | Input, Field, InputGroup, Select, NativeSelect, Combobox, Checkbox, Switch, Slider, Calendar |
| Display | Card, Item, Table, Avatar, Badge, Skeleton, Kbd |
| Feedback | Alert, Empty, Progress, Spinner, Toaster |
| Navigation | Tabs, Breadcrumb, Pagination, Accordion, NavigationMenu, Menubar |
| Overlays | Dialog, Sheet, Drawer, Popover, DropdownMenu, ContextMenu, HoverCard, Tooltip |
| Layout | ScrollArea, Separator, AspectRatio, Carousel |
| Typography | Heading, Text, Prose |
| Visuals | Icon, Image, Gradient, SVG, Chart, Placeholder |
| Chat & AI | Message, Bubble, Attachment, Marker |

## Reach for the family, not a Box stack

The most common waste is rebuilding something the library already has. Check the shelf first:

| If you're about to build… | Use |
| --- | --- |
| Label + input + help text + error | \`Field\` (+ \`FieldGroup\`, \`FieldSet\`) |
| An input with an icon or unit inside its border | \`InputGroup\` |
| A settings row, file row, notification row | \`Item\` (+ \`ItemGroup\`) |
| A "no results yet" panel | \`Empty\` |
| Buttons welded into a segmented control | \`ButtonGroup\` |
| A keyboard shortcut hint | \`Kbd\` |
| A plain option list | \`NativeSelect\` (\`Select\` is for rich rows) |

A hand-built version loses the library's spacing, focus and disabled states, and dark-mode behavior — and \`emit_code\` then hands the developer a div stack instead of the component their app already imports. \`Box\` is still right for the *page* scaffolding around these.

## Layout

Use \`Box\` (a plain div) for every flex/grid wrapper. \`Box as="span"\` / \`"strong"\` / \`"a"\` renders an *inline* element — inline tags get their natural inline display, so inline runs do not stack vertically.

Reserve \`Card\` for actual card surfaces: it ships card chrome, and only *image* cards clip to the rounded corners, so an outside-the-box child (a \`-top-3\` "Most popular" badge) can overflow a bare Card.

## Text

Text content for \`Heading\`, \`Text\`, \`Button\`, \`Badge\`, \`Label\` goes in the \`children\` prop — there is no \`text\` prop.

The \`children\` **array** (\`node.children\`) is for nodes; a bare string or number there auto-wraps into an inline \`Box as="span"\`, so \`children: ["Most popular"]\` just works.

For **inline rich text** — a styled span mid-sentence, like a gradient word in a headline — put an array in the \`children\` **prop**, mixing strings and nodes:

\`\`\`json
{"$ref":"Heading","props":{"children":["You get ",{"$ref":"Text","props":{"className":"text-primary","children":"the math right"}}]}}
\`\`\`

Text runs keep their exact spacing; inline nodes flow inline. A plain string \`children\` is still the common case.

## Icons and imagery

\`Icon\` takes a lucide-react name as its \`name\` prop — PascalCase ("ArrowRight") or kebab-case ("arrow-right") both resolve. A name matching no lucide icon renders a fallback "?" glyph, and the mutation result carries an advisory warning.

For placeholder imagery (avatars, hero shots) use the \`Placeholder\` component rather than faking one with gradient divs.

## Raw CSS when no utility fits

An object \`style\` prop is supported for CSS no utility expresses cleanly — a \`radial-gradient\` dot-grid, a custom \`backgroundSize\`, a one-off \`clipPath\`:

\`\`\`json
{"$ref":"Box","props":{"style":{"backgroundImage":"radial-gradient(…)","backgroundSize":"14px 14px"}}}
\`\`\`

It renders inline and \`emit_code\` writes a \`style={{…}}\` JSX prop. Reach for utility or arbitrary classes first where they exist — they keep theme-awareness, and classes passed through snippet *string params* compile fine. Reserve \`style\` for literal CSS.

(On a non-Tailwind folder the \`style\` **channel** of \`update_props\` is the normal way to style; this note is about the raw prop on a Tailwind folder.)`,
  },

  boards: {
    title: "Boards, frames, and groups",
    blurb: "How placements, sidebar groups, archiving, and board themes work.",
    body: `# Boards, frames, and groups

## The model

A screen has ONE tree. Viewport size is a property of each \`frame\` *placement* on a board, not of the screen.

- Different viewport renderings of the same screen → multiple frames pointing at the same screen. Edits sync.
- Different layouts per breakpoint → separate screens, each with their own frames.

A frame's optional light/dark \`scheme\` is placement-level and only a review affordance: it pins how that one frame renders the shared tree. It does not create a dark layout variant. \`scheme: null\` returns the frame to the canvas default.

## Sidebar groups

A group is an area of work — "Side pane", "Account page", "Brand" — holding a set of boards. \`list_boards\` reports each board's \`group\` by name; pass that name to \`add_board\` / \`update_board\` to file a new board alongside it, or a *new* name to create the group on the spot. \`update_board { patch: { group: null } }\` unfiles it.

File a board you create into the group its work belongs to rather than leaving it loose. But do not reorganize the user's existing groups — renaming, recoloring and deleting them is theirs to do in the canvas.

## Archived boards are the user's filing cabinet

\`list_boards\` shows live boards only. A board the user archived is hidden there, in the canvas sidebar, and in a default publish — but its frames and screens are intact and still editable.

Pass \`includeArchived: true\` to see them; they carry \`archivedAt\`. Don't design into an archived board unless the user names it, and prefer \`update_board { patch: { archived: true } }\` over \`remove_board\` when they want one out of the way.

## Themes attach to boards

Never to screens or frames. A board pins a named theme via \`update_board { theme }\` and every frame on it renders with that palette; unpinned boards use the folder default. See velloo://guide/theme.`,
  },

  extensions: {
    title: "Extensions",
    blurb: "Registering your app's own components, live islands, codegen imports.",
    body: `# Extensions

An extension registers a user-owned custom component into the design folder so it can appear in screen trees. The user already implements it in their app; \`add_extension\` tells Velloo about it. The canvas renders a dashed placeholder card (id + resolved props + importPath — good enough to design layout against) and \`emit_code\` produces a correct import.

## When to use

A screen needs a component the active library does not have: your app's bespoke \`DataTable\`, a brand-specific \`Hero\`, a custom \`Chart\`.

## When NOT to use

- **Compositions of existing components** → \`add_snippet\`. Snippets are subtrees with typed params, and they render for real.
- **Swapping a whole library palette** → pin the screen's \`library\` instead.
- **Variations on an existing component** → props or class overrides.

## Props schema

Each prop entry has \`name\`, \`type\` (free-form TS-shaped string, for display), \`optional\`, and a \`control\` of \`boolean | number | string | color | enum | icon\` (\`enum\` also takes \`enumValues: string[]\`). \`defaultValue\` (string) shows in the placeholder when the prop is not set. This mirrors a library component's manifest entry — the inspector renders the same controls.

## Live preview (\`render: "live"\`)

For components whose visual fidelity needs the real implementation — charts above all — pass \`render: "live"\`. Velloo bundles the actual component from the app (resolved from \`importPath\` against the host app and its \`node_modules\`) and client-mounts it in the canvas, and in \`screenshot\` / \`compare_to_url\` / \`render_snippet\`.

The component must be browser-renderable (no server-only imports). The preview is visual-only — clicks select the node — and any bundle or render failure falls back to the placeholder.

The built-in \`Chart\` node already previews via echarts and needs no extension, but it will NOT pixel-match an app built on recharts/visx/chart.js. Porting a charts-heavy app, reach for a \`render:"live"\` extension of the app's own chart component.

In a monorepo folder (\`config.hostApps\` names several apps), also pass \`app: "<key>"\` so the island bundles from the component's own app.

## Codegen

\`emit_code\` writes \`import { <id> } from "<importPath>"\` exactly as supplied — use the alias the app actually uses (\`@/components/data-table\`).

## Shadowing

An extension shadows a library component with the same id (your \`Button\` wins over shadcn's on every screen). The response surfaces \`shadowedLibraryComponent\` when this happens, so you can rename if it was unintentional.

## Example

\`\`\`
add_extension({
  id: "PriceChart",
  importPath: "@/components/charts/PriceChart",
  render: "live",
  props: [{ name: "data", type: "Point[]", optional: false, control: "string" }],
  description: "Recharts price chart"
})
\`\`\``,
  },

  porting: {
    title: "Porting an app (code-to-design)",
    blurb: "Re-expressing an existing app's pages on the canvas, and verifying fidelity.",
    body: `# Code-to-design: porting an existing app

**Re-express — do not clone.** The extract is evidence, not a tree.

## The loop

**1. Import the theme first.** \`import_theme\` with the app's globals.css (\`cssPath\` — absolute, or relative to the host app root, since globals.css lives OUTSIDE the design folder). Dry-run first, then \`apply: true\`. Do this BEFORE any composition, so semantic slots, the raw \`palette.*\` passthrough (brand vars like \`--ink\`, scales like \`--primary-600\`), fonts, and the tailwind.config's \`theme.extend\`/\`container\` all resolve — then verbatim app classes like \`bg-ink\` render as-is. Tweak entries with \`set_theme { tokens: { "palette.<name>": … } }\`; mutations report unresolved classes beside their paths. See the \`theme\` guide.

**2. Build into the existing screen.** Read the page's source alongside \`list_components\`, then call \`compose { mode: "replace", jsx: … }\` on the route-scan's placeholder screen. (\`add_screen\` on a scanned route returns \`ScreenIdConflict\`.) Strip handlers, state and data-fetching; inline representative copy as literals; keep Tailwind classes verbatim, since shadcn apps share Velloo's component vocabulary and most tags map 1:1.

**3. Map components snippet-first, extension-second.** A presentational custom component (FeatureCard, PricingRow) becomes a snippet with typed params — snippets render for real. A complex app-specific component (DataTable, charts) becomes \`add_extension\` with its real importPath, so capture → redesign → emit never loses component identity.

**4. Verify with \`compare_to_url\`** at the same viewport. 0.85+ similarity is a faithful structural port. The result's \`topMismatches\` lines rank the worst regions and name the node responsible (share of diff, rect, node ref/id/path) — fix them in order. Do not chase 1.0: fonts and imagery legitimately differ.

## When the capture is not your page

**If the result is \`unverified\`, STOP — the similarity is meaningless there.**

- \`redirected\` / \`authWall\` — the URL bounced to a login page. Pass \`source.auth\` (\`storageStatePath\`, or \`cookies\`/\`localStorage\`), or use a capture session (below).
- \`pageError\` — the target app is throwing or rendered blank. Fix its dev server first; a data-heavy page that paints a loading spinner needs a higher \`settleTimeoutMs\`.

If you cannot get a real capture, leave the screen flagged unverified and tell the user, rather than iterating against a page you never saw.

For a DYNAMIC page whose content changes between loads (feed, dashboard, per-user content), pass \`source.cache.freeze: true\` so repeated calls diff against ONE frozen capture instead of drifting live content. \`cache.ttlMs\` bounds staleness; \`cache.refresh: true\` re-samples after you have changed the target app.

## Known canvas-vs-app gaps

Do not chase the small similarity dip these cause:

- \`dark:\` variant classes are inert. Velloo dark mode swaps token values, not a class — use the semantic token instead.
- Radix \`AvatarImage\` SSR-captures as its fallback. Re-express avatars as \`Image\`.
- The app's vendored shadcn may predate the snapshot. Re-add drifted classes explicitly.
- The headless render substitutes some emoji and does not fetch remote images. Use \`upload_asset\` + a local \`Image\`/\`Placeholder\` for art you need pixel-faithful.

Data-heavy pages get fixture copy — designs are static by construction.`,
  },

  capture: {
    title: "Browser capture",
    blurb: "Reaching pages behind a login: user-driven capture sessions.",
    body: `# Browser capture

When the target is behind a login, on staging, or on a third-party site, \`start_capture_session { url }\` opens a real browser window that the USER drives.

## It is not blocking

It returns a \`sessionId\` IMMEDIATELY and does not wait for the session. Never treat it as blocking, and never re-call it to "check" — poll \`list_captures\` instead.

Tell the user plainly what to do: log in, then hit **Capture page** in the velloo toolbar on each page you need, then **Done**.

## Reading the evidence

Read each result with \`get_capture\`. You get:

- a structural \`outline\` with repeated blocks marked — a run of identical siblings is ONE component instantiated N times, so build a snippet, not N copies;
- \`themeCss\`, the page's real custom properties including any dark block, to feed \`import_theme\` BEFORE composing;
- \`fonts\`;
- downloaded image \`assets\` for \`upload_asset\`.

Then **re-express the page with real components — do not transcribe the DOM node-for-node.**

## Verifying against a capture

Verify with \`compare_to_url { source: { captureId } }\` rather than a live \`url\`. A stored capture is already past the login and frozen, so it cannot bounce to a login page or drift between calls — a stability a live gated URL never has.

\`source.auth\` (\`storageStatePath\` / \`cookies\` / \`localStorage\`) remains the manual alternative when you already hold a session.

Captures live outside the design folder and the user can delete them. You never see session cookies.`,
  },

  theme: {
    title: "Theme and typography",
    blurb: "Tokens, presets, importing an app's CSS, fonts, and the type ladder.",
    body: `# Theme and typography

The token model is shared across frameworks — prefer theme tokens over hard-coded values in any style channel.

## Prefer semantic tokens

Prefer semantic theme tokens (\`bg-background\`, \`bg-card\`, \`text-foreground\`, \`text-muted-foreground\`, \`border-border\`, \`bg-primary\`, \`bg-accent\`) over raw Tailwind palette colors (\`bg-zinc-900\`, \`text-white\`, \`text-emerald-400\`). Semantic tokens auto-flip under \`screenshot mode: "dark"\` and survive theme changes; raw palette colors render identically in both modes. Use raw palette only for *intentional* accent colors that should NOT theme-flip.

## set_theme

One verb for the whole token document. Pass any combination:

- \`tokens\` — a path→value patch (\`{ "colors.primary.DEFAULT": "#4f46e5", "radius.md": "0.5rem" }\`).
- \`fonts\` — font roles. Declare a display face (role \`"display"\` → class \`font-display\`) before composing. Google Fonts load in design mode and emit into globals.css.
- \`typeset\` — the typographic *rhythm*: three controls (\`size\`, \`leading\`, \`flow\`) that the entire type ladder derives from, plus which font role paints headings vs body.
- \`customCss\` — keyframes, grain/noise textures, clip-paths, \`::selection\`.
- \`from\` — reseed the palette wholesale: \`{ preset: "<name>" }\` for a named starter palette, or \`{ seedColor: "#4f46e5" }\` to derive one from a single color.

\`theme:\` targets a named theme; omitted, it edits the folder default.

**Set the typeset once, early.** One call re-proportions every screen coherently, and it is the difference between "shadcn defaults" and a designed page. Retune the rhythm rather than overriding \`text-*\` node by node.

## Importing an app's stylesheet

\`import_theme\` seeds the theme from an existing app's CSS instead of picking colors by hand. It parses shadcn-convention custom properties — \`:root\` / \`.dark\` \`--background\`-style vars (raw HSL triplets or any CSS color) and Tailwind v4 \`@theme\` \`--color-*\` vars, with \`var()\` indirection resolved — plus \`--radius\` and \`--font-*\` roles.

**It also captures every non-semantic color var into the theme's \`palette\`**: numeric scales (\`--primary-600\`), extra roles (\`--success-500\`), bare brand names (\`--ink\`). That is what makes verbatim app classes like \`bg-primary-600\` / \`bg-ink\` resolve literally on the canvas instead of silently falling back. \`palette.*\` entries are raw passthroughs that do not theme-flip, unlike the semantic \`colors.*\` slots.

Slots the CSS does not declare keep their current values.

Given a \`cssPath\`, it also reads the nearby tailwind.config (or an explicit \`tailwindConfigPath\`) and ingests its \`theme.extend\`: brand \`colors\` → \`palette\`, named \`spacing\` → spacing tokens (\`w-icon-rail\`), \`boxShadow\` → \`shadows\` (\`shadow-card\`), \`fontFamily\` → font roles, \`keyframes\` + \`animation\` → \`--animate-*\`. CSS-derived values win over config literals of the same name. It also applies the app's \`container\` config so \`class="container"\` centers/pads/caps to match, reporting the equivalent \`container.suggestedClasses\` if you would rather wrap content explicitly.

**Dry-run by default** — returns the would-be token changes; pass \`apply: true\` to persist.

## The type ladder

Text content for \`Heading\`, \`Text\`, \`Button\`, \`Badge\`, \`Label\` goes in the \`children\` prop, not a \`text\` prop.

\`Heading.level\` controls only the HTML tag plus the theme's type ladder (h1 → \`text-h1\`, h6 → \`text-h6\`). \`Text.variant\` picks its rung (\`default\`/\`lead\`/\`small\`/\`muted\`). Those sizes come from the active typeset.

To override one node anyway, pass an explicit \`text-*\` size in \`className\`. A className with only spacing/weight (\`mb-1 font-semibold\`) leaves the ladder size in place; add \`text-base\` to actually shrink it.

**For long-form content, wrap it in \`Prose\` instead of styling each block.** A \`Prose\` region styles the HTML inside it — headings, paragraphs, lists, quotes, code, tables — with correct vertical rhythm from the typeset, and \`preset\` switches to a named typeset (e.g. \`preset: "docs"\`) for that region only. Reach for it for articles, docs, changelogs, marketing copy, chat transcripts, and anything markdown-shaped. Per-node \`text-*\` on a stack of paragraphs is the anti-pattern it replaces.

## Named themes attach to boards

Named themes (\`add_theme\`, \`list_themes\`) are variants of the token tree. A board pins one via \`update_board { theme }\` and every frame on it renders with that palette; unpinned boards use the folder default. Screens stay theme-portable by construction — the same screen framed on two boards shows both palettes, edits syncing to both.

Theme-aware tools resolve the same way: \`screenshot\` / \`compare_to_url\` default to the hosting board's pin (boards disagreeing is an error asking for an explicit \`theme:\`), and \`get_theme\` / \`score_theme_contrast\` / \`emit_theme\` / \`set_theme\` take \`theme:\` to target a named theme.`,
  },

  verification: {
    title: "Verifying a screen",
    blurb: "Automatic diagnostics, screenshot, and inspect — the check-your-work loop.",
    body: `# Verifying a screen

## screenshot

When a screen feels done, run \`screenshot mode: "compare"\` — one PNG with light and dark rendered side by side, the fastest signal that the design actually adapts.

While iterating, \`diff: true\` compares against your previous capture: zero change costs no image at all, and small changes return a highlight crop naming the changed nodes. Pass \`scale: 0.5\` when checking layout (smaller payload), and \`path\` to capture a single node close-up.

**Frames are not viewports.** A frame's \`w\`/\`h\` is canvas layout only. \`screenshot\` and \`compare_to_url\` render at their OWN viewport (explicit \`w\`/\`h\`/\`viewport\` argument, defaulting to the Desktop preset), and \`fullPage: true\` (the default) captures the screen's full natural height. So a screenshot can look complete while the board frame still clips below the fold. The returned \`contentHeight\` and \`framesShorterThanContent\` are the signal that a placement needs a taller frame (\`update_frame\`) or the screen needs splitting.

A frame's optional light/dark \`scheme\` is placement-level and only a review affordance: it pins how that one frame renders the screen's shared tree. It does not create a dark layout variant. \`scheme: null\` returns the frame to the canvas default. An omitted \`screenshot\` mode follows an agreed hosting-frame pin, and asks for an explicit mode when placements disagree.

## Automatic diagnostics

Tree mutations validate the nodes they touched and return \`diagnostics\` only when there is something to fix. Invalid Tailwind utilities, undefined CSS variables, Tailwind v3 incompatibilities, and raw colors that will not theme-flip all name the affected node path. \`screenshot\` and \`emit_code\` repeat the check over the complete screen, so verification cannot be skipped accidentally.

Diagnostics are **triage signals, not gates.** A deliberate brand gradient or status color may be correct. Set \`data-accent: "ok"\` (or any string) on a deliberately non-flipping node to exempt it from the theme warning.

## inspect

Returns SSR'd HTML plus resolved props for a specific node, when you need to verify what actually landed.`,
  },

  art: {
    title: "Art and assets",
    blurb: "Authoring SVG vs paying for generation; costs and intents.",
    body: `# Art and assets

## Author it yourself first

\`upload_asset\` takes your own SVG or raster art — hero shapes, textures, marks — and you reference it as \`<Image src="/assets/…">\`. Reach for this whenever you can author the thing yourself: flat shapes, gradients, geometric marks. \`import_assets\` brings in files that already exist on disk. \`list_assets\` shows what the folder already has — check it before generating something you may already have made.

## generate_asset costs the user real money

Photography, textured illustration and true vector logos are the one place Velloo spends the user's money. \`generate_asset\` is PAY-AS-YOU-GO against their credit balance and needs \`velloo login\`.

Name an *intent* and the server picks the model:

\`photo\`, \`illustration\`, \`graphic\` (layouts with legible text), \`texture\`, \`icon\`, \`vector\`, \`mark\`, \`edit\`, \`cutout\`, \`upscale\`.

Because it costs real money:

- Reach for \`upload_asset\` first whenever you can author the thing yourself.
- Iterate prompts at \`count: 1\`; only spend \`count: 2-4\` on an asset that matters.
- **ALWAYS relay the returned cost and remaining balance to the user.**

Feed an existing asset back in via \`reference\` to restyle it, edit it, or cut out its background.

## Making a design distinctive

Default shadcn + Inter + one indigo reads as template. The levers, in rough order of impact:

1. \`set_theme { fonts }\` — declare a display face before composing.
2. \`set_theme { typeset }\` — the type rhythm every screen derives from. One call re-proportions everything.
3. \`set_theme { customCss }\` — keyframes, grain/noise textures, clip-paths, \`::selection\`.
4. \`upload_asset\` — author your own art.
5. \`set_theme { from: { seedColor } }\` or \`{ tokens }\` — an opinionated palette instead of the default.

Big type, real art, confident color — then verify with screenshots.`,
  },

  comments: {
    title: "Visual feedback threads",
    blurb: "Working the user's canvas comments; local vs shared scopes.",
    body: `# Visual feedback threads

Comment threads are persistent app state, not design files.

**Every open thread is addressed to you.** The user leaves one expecting the design to change, so there is nothing to opt into and nothing to wait for.

## The loop

Call \`list_comment_threads\` at the start of a session, and again whenever the user mentions comments. Then work the open ones:

1. Read the complete conversation and its node/board anchor with \`get_comment_thread\`.
2. Make the requested design change.
3. \`update_comment_thread { threadId, reply: "…" }\` to answer.
4. \`update_comment_thread { threadId, status: "resolved" }\` to close it.

Both can go in one call: \`update_comment_thread { threadId, reply, status: "resolved" }\`.

## Scopes

Threads come in two scopes and both are yours:

- \`local\` — pinned by the user in their own canvas.
- \`shared\` — left by a reviewer on a published link.

\`scope:\` narrows the list when you want them apart.

## Stale anchors

A stale anchor means the original node no longer exists. Use its saved bounds and fingerprint as context, but do NOT silently attach it to a different node.

## Deletion

\`update_comment_thread { status: "deleted" }\` is permanent — use it only when the user explicitly asks.

Canvas notes are a different thing: repo-owned board artifacts for durable design guidance, created with \`add_note\`.`,
  },
};

type GuideSlug = keyof typeof GUIDES;

/** `velloo://guide/<slug>` for a guide the tool descriptions can point at. */
const guideUri = (slug: GuideSlug): string => `velloo://guide/${slug}`;

/**
 * Register every guide as a readable resource. The listing is what a session
 * pays for at boot — one uri + title + blurb each — so blurbs stay to a line.
 */
export function registerGuideResources(mcp: McpServer): void {
  for (const [slug, guide] of Object.entries(GUIDES)) {
    mcp.registerResource(
      `guide-${slug}`,
      guideUri(slug),
      {
        title: guide.title,
        description: guide.blurb,
        mimeType: "text/markdown",
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "text/markdown", text: guide.body }],
      }),
    );
  }
}
