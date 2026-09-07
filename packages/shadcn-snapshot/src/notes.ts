/**
 * Per-component `designModeNotes`, merged into the generated manifest by
 * build.ts.
 *
 * Scoped to one job: telling an agent *when to reach for a component instead
 * of building the same thing out of `Box` and `Text`*. Prop names already say
 * what a component accepts and `example` shows the shapes; neither says that
 * a label/control/help-text stack is what `Field` is for. That gap matters
 * most for the families that postdate most models' training data (Field,
 * InputGroup, Item, Empty, ButtonGroup, Spinner, Kbd, the chat set), which
 * otherwise get hand-rolled — so notes go on family roots, and on the handful
 * of sub-pieces whose own role isn't obvious from the name.
 *
 * Keep them to a couple of sentences. The composition shape belongs here as a
 * JSX sketch because `compose` takes exactly that syntax.
 */
export const COMPONENT_NOTES: Record<string, string> = {
  // ---- Forms -------------------------------------------------------------
  Field:
    "The form-field scaffold — reach for this instead of stacking Label + Input + help text by hand. " +
    "`<Field><FieldLabel htmlFor='email'>Email</FieldLabel><Input id='email'/>" +
    "<FieldDescription>We never share it.</FieldDescription></Field>`. " +
    'Set `orientation="horizontal"` to put the label beside the control (checkbox/switch rows), ' +
    "`FieldGroup` to stack several fields with consistent spacing, and `FieldSet` + `FieldLegend` for a titled section.",
  FieldError:
    "Renders a list, so `errors` takes objects: `[{ message: 'Enter a valid email.' }]` — not a string. " +
    "Place it last inside a `Field`.",
  FieldSeparator: "An 'or' divider between fields; put the label in `children`.",
  InputGroup:
    "An input with something attached inside its border — a leading icon, a trailing unit, a submit button. " +
    "`<InputGroup><InputGroupAddon><Icon name='search'/></InputGroupAddon><InputGroupInput placeholder='Search'/></InputGroup>`. " +
    "Use `InputGroupInput`/`InputGroupTextarea` rather than a bare `Input` inside it, and " +
    '`InputGroupAddon align="inline-end"` for the trailing slot. This is the component for search bars and prefixed URL fields.',
  NativeSelect:
    "A real `<select>` — one tap-to-open list on mobile, and it renders faithfully in design mode. " +
    "Prefer it over `Select` for plain option lists; `Select` is the Radix listbox, needed only for rich/custom option rows. " +
    "Children are `NativeSelectOption` (and `NativeSelectOptGroup`).",
  Combobox:
    "Type-to-filter selection: `ComboboxInput` + `ComboboxList`/`ComboboxItem`, with `ComboboxChips` for multi-select. " +
    "In design mode the list renders open and inline so you can see it; filtering does not run.",

  // ---- Actions -----------------------------------------------------------
  ButtonGroup:
    "Joins adjacent buttons into one segmented control — shared borders, rounded only on the ends. " +
    "Use it instead of a flex `Box` with `gap`, which leaves them as separate buttons. " +
    "`ButtonGroupText` adds a static label segment; `ButtonGroupSeparator` divides groups.",

  // ---- Display -----------------------------------------------------------
  Item:
    "One row of a list — the generic list-row surface, and the right building block for settings rows, " +
    "notification lists and file lists that would otherwise be a hand-built flex `Box`. " +
    "`<Item><ItemMedia><Icon name='file'/></ItemMedia><ItemContent><ItemTitle>Report.pdf</ItemTitle>" +
    "<ItemDescription>2.4 MB</ItemDescription></ItemContent><ItemActions><Button/></ItemActions></Item>`. " +
    "`ItemGroup` wraps a list; use `Card` only for actual card surfaces.",
  Kbd: "A keyboard key cap (`⌘`, `K`). `KbdGroup` sets a chord — reach for it in shortcut hints and command-menu rows.",

  // ---- Feedback ----------------------------------------------------------
  Empty:
    "The empty-state surface: centred icon, heading, explanation, action. " +
    "`<Empty><EmptyHeader><EmptyMedia><Icon name='inbox'/></EmptyMedia><EmptyTitle>No invoices</EmptyTitle>" +
    "<EmptyDescription>Create one to get started.</EmptyDescription></EmptyHeader><EmptyContent><Button/></EmptyContent></Empty>`. " +
    "Use it for any 'nothing here yet' panel rather than centring text in a `Box`.",
  Spinner:
    "An inline loading indicator. Size it with a class (`size-4`) and pair it with `Skeleton` for block-level placeholders.",

  // ---- Overlays ----------------------------------------------------------
  Drawer:
    "A sheet that slides from an edge with a drag handle — the mobile-idiomatic bottom sheet. " +
    "For a desktop side panel prefer `Sheet`; the two are otherwise the same shape. " +
    "Rendered open and inline in design mode.",
  HoverCard:
    "A rich preview shown on hover (user cards, link previews) — not a `Tooltip`, which is for a short text hint. " +
    "Rendered open and inline in design mode.",
  ContextMenu:
    "The right-click menu. Same item vocabulary as `DropdownMenu`, which is the one to use for a button-triggered menu. " +
    "Rendered open and inline in design mode.",

  // ---- Navigation --------------------------------------------------------
  Menubar:
    "A persistent application menu bar (File / Edit / View). For a single button-triggered menu use `DropdownMenu`. " +
    "Rendered open and inline in design mode.",
  NavigationMenu:
    "Site-level navigation with rich dropdown panels — marketing headers. " +
    "For in-page section switching use `Tabs`.",

  // ---- Chat & AI ---------------------------------------------------------
  Bubble:
    "One chat turn's speech bubble; `BubbleGroup` stacks consecutive turns from the same author " +
    "and `BubbleReactions` adds the reaction row. For a full turn with avatar and header, use `Message`.",
  Message:
    "A full chat turn: `MessageAvatar` + `MessageHeader` + `MessageContent` (+ `MessageFooter`). " +
    "`MessageGroup` wraps a transcript. Use `Bubble` when you only need the bubble itself.",
  Attachment:
    "A file chip attached to a chat message — `AttachmentMedia` + `AttachmentTitle`/`AttachmentDescription`, " +
    "with `AttachmentGroup` for several and `AttachmentActions` for remove/download.",
  Marker: "Inline annotation highlighting a span of chat text (citations, references).",
};
