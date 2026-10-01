/**
 * The two places upstream shadcn lands, side by side so the difference between
 * them is something you read rather than something you reconstruct from two
 * scripts.
 *
 * They exist separately because they have to behave differently, not because
 * the pull differs: the snapshot's overlays are pinned open and rendered inline
 * so a static design iframe can select them, while the chrome needs real Radix
 * portals, working dialogs and a live toaster. Everything mechanical — the pin,
 * the fetch, the icon collapse, the import rewrite, the formatting — is
 * `pipeline.ts`, and neither copy carries a dependency on the other.
 */
import type { VendorTarget } from "./pipeline.ts";

/**
 * The design-mode fork `@velloo/renderer` server-renders into design iframes.
 *
 * Its `adapted` set is the canvas-safe contract, not a backlog: a component
 * lands there because a real portal escapes the iframe, because a design ships
 * a controlled prop with no handler to change it, or because the upstream
 * library renders nothing under static SSR.
 */
const SNAPSHOT: VendorTarget = {
  id: "snapshot",
  description: "@velloo/shadcn-snapshot — the canvas-safe design-mode fork",
  packageDir: "packages/shadcn-snapshot",
  uiDir: "src/components/ui",
  sharedCssPath: "src/shadcn-tailwind.css",
  sharedCssImporter: "tailwind-entry.css",
  imports: { utils: "../../lib/utils.ts", sibling: (id) => `./${id}.tsx` },
  keepUseClient: true,
  headerNote: "Design-mode fork for the Velloo canvas — not the shadcn the IDE chrome renders.",
  recordsPullDate: true,
  catalog: [
    "accordion",
    "alert",
    "alert-dialog",
    "aspect-ratio",
    "attachment",
    "avatar",
    "badge",
    "breadcrumb",
    "bubble",
    "button",
    "button-group",
    "calendar",
    "card",
    "carousel",
    "chart",
    "checkbox",
    "collapsible",
    "combobox",
    "context-menu",
    "dialog",
    "direction",
    "drawer",
    "dropdown-menu",
    "empty",
    "field",
    "hover-card",
    "input",
    "input-group",
    "item",
    "kbd",
    "label",
    "marker",
    "menubar",
    "message",
    "native-select",
    "navigation-menu",
    "pagination",
    "popover",
    "progress",
    "radio-group",
    "scroll-area",
    "select",
    "separator",
    "sheet",
    "skeleton",
    "slider",
    "sonner",
    "spinner",
    "switch",
    "table",
    "tabs",
    "textarea",
    "toggle",
    "toggle-group",
    "tooltip",
  ],
  skipped: {
    command:
      "needs cmdk, and a command palette is keystroke behaviour a static frame cannot show — Combobox carries the filtered-list look",
    form: "the radix-nova registry serves no file for it: react-hook-form wiring, and a design carries no form state",
    "input-otp":
      "needs input-otp, which would ship inside the CLI binary, and every slot draws its character, caret and active ring from that library's focus-driven context — a static frame shows empty boxes until it is adapted, and a row of Input carries the look meanwhile",
    "message-scroller":
      "needs @shadcn/react, and scroll-follow is behaviour that is invisible in a static frame",
    questionnaire:
      "needs @shadcn/react, and a multi-step survey is flow, which a design expresses as separate screens",
    resizable:
      "needs react-resizable-panels, and a panel's size is frame geometry in Velloo rather than a component prop",
    sidebar:
      "not a verbatim pull: a provider with cookie-persisted state, a keyboard shortcut and a mobile Sheet, so it needs its own canvas adaptation first",
    toast:
      "the radix-nova registry serves no item for it — Sonner is upstream's toast, and the snapshot carries it",
  },
  adapted: new Set([
    // Overlays: content renders inline and pinned open instead of portalled.
    "alert-dialog",
    "combobox",
    "context-menu",
    "dialog",
    "drawer",
    "dropdown-menu",
    "hover-card",
    "menubar",
    "popover",
    "select",
    "sheet",
    "sonner",
    "tooltip",
    // Static-state contract: a design ships `checked` / `value` / `open` with no
    // handler to show a populated state, which React otherwise warns about and
    // renders inert. These promote it to the uncontrolled equivalent, and open
    // collapsed containers so the styling is visible without interaction.
    "accordion",
    "checkbox",
    "collapsible",
    "input",
    "slider",
    "switch",
    "textarea",
    "toggle-group",
    // JSON-shaped props: a design can only carry scalars, so these accept the ISO
    // string or plain value in place of the Date / rich object upstream expects.
    "calendar",
    // Preview stand-in: echarts SSRs to SVG, recharts renders nothing statically.
    "chart",
  ]),
  patches: {
    // Empty since the 2026.09.03 pull: every component that needed a fix also
    // needed a behaviour change, so it lives in `adapted` and is hand-maintained.
  },
};

/**
 * The IDE chrome's copy: real shadcn inside the Vite SPA.
 *
 * Its `adapted` set is meant to stay near-empty. Where the snapshot's
 * divergences *are* the contract, one here is an accessibility fix or a bug
 * upstream has not taken — so prefer a wrapper in `src/components/`, and only a
 * change the file itself must carry earns a place in the set.
 */
const CHROME: VendorTarget = {
  id: "chrome",
  description: "@velloo/canvas — real shadcn for the IDE chrome",
  packageDir: "packages/canvas",
  uiDir: "src/components/ui",
  sharedCssPath: "src/shadcn-tailwind.css",
  sharedCssImporter: "styles.css",
  imports: { utils: "@/lib/utils", sibling: (id) => `@/components/ui/${id}` },
  keepUseClient: false,
  headerNote: "Real shadcn for the IDE chrome — NOT the canvas-safe snapshot fork.",
  recordsPullDate: false,
  catalog: [
    "accordion",
    "alert",
    "alert-dialog",
    "avatar",
    "badge",
    "breadcrumb",
    "bubble",
    "button",
    "button-group",
    "card",
    "checkbox",
    "collapsible",
    "dialog",
    "dropdown-menu",
    "empty",
    "field",
    "input",
    "input-group",
    "item",
    "kbd",
    "label",
    "message",
    "native-select",
    "popover",
    "select",
    "separator",
    "skeleton",
    "slider",
    "sonner",
    "spinner",
    "switch",
    "table",
    "tabs",
    "textarea",
    "toggle",
    "toggle-group",
    "tooltip",
  ],
  skipped: {
    "aspect-ratio": "the chrome sizes its own panes; nothing in the IDE is ratio-locked",
    attachment: "a design-mode chat family; the comment threads compose Bubble and Message only",
    calendar: "needs react-day-picker and date-fns, and the IDE picks no dates",
    carousel: "needs embla-carousel-react; a board pans and zooms rather than paginating",
    chart: "needs recharts, and the chrome renders no charts of its own",
    combobox: "needs @base-ui/react; the chrome's pickers are Select or DropdownMenu",
    "context-menu":
      "no right-click menu in the IDE — every menu hangs off a button, so DropdownMenu is the one that ships",
    command: "needs cmdk; Ctrl+K search is the chrome's own dialog over InputGroup, Kbd and Empty",
    direction: "an RTL context provider — the IDE chrome itself is LTR",
    drawer: "needs vaul; the chrome's overlays are Dialog and Popover",
    form: "the radix-nova registry serves no file for it: react-hook-form wiring, and the chrome's forms are Field over local state",
    "hover-card":
      "the chrome explains itself with Tooltip, which is the same hover with less surface",
    "input-otp": "needs input-otp; the IDE asks for no one-time codes",
    marker: "a design-mode annotation glyph; canvas annotations are the chrome's own layer",
    menubar: "the IDE has no menu bar — its menus hang off buttons, so DropdownMenu covers them",
    "message-scroller": "needs @shadcn/react; the comment thread manages its own scrolling",
    "navigation-menu": "a marketing-site nav; the chrome navigates through boards and frames",
    pagination: "nothing in the IDE is paged",
    progress: "the one long operation, publish, reports per-screenshot counters rather than a bar",
    questionnaire: "needs @shadcn/react; there is no survey surface in the IDE",
    "radio-group": "the chrome's exclusive choices are ToggleGroup or Select",
    resizable:
      "needs react-resizable-panels; the chrome's panels are docked chrome with their own drag handles",
    "scroll-area":
      "the IDE's panels scroll natively; a styled scrollbar over a pannable board fights the board",
    sheet: "the IDE's side panels are docked layout, not overlays",
    sidebar:
      "not a verbatim pull: a provider with cookie-persisted state and a mobile Sheet, where the IDE's rails are its own layout",
    toast:
      "the radix-nova registry serves no item for it — Sonner is upstream's toast, and the chrome carries it",
  },
  adapted: new Set([
    // aria-label moved onto the thumb, where Radix puts role="slider"; plus a
    // `tone` prop for a control showing an inherited rather than authored value.
    "slider",
    // Upstream's Toaster reads next-themes; the canvas owns its own dark mode.
    "sonner",
    // SubContent is portalled out of the parent Content, whose
    // `overflow-x-hidden overflow-y-auto` clips every submenu away.
    "dropdown-menu",
  ]),
  patches: {
    // Empty: the two exactOptionalPropertyTypes fixes (Slider's value /
    // defaultValue, DropdownMenu's checked) sit in adapted files, so they are
    // carried there by hand with the rest of each divergence.
  },
};

export const TARGETS: readonly VendorTarget[] = [SNAPSHOT, CHROME];
