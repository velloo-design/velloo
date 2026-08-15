# @velloo/shadcn-adapter

Canvas-safe adapter layer for shadcn components. Provides hand-written
replacement modules for the shadcn primitives that aren't iframe-safe
in design mode (overlays + runtime-heavy components) plus the policy
table the upstream provider's bundler consults to decide
passthrough-vs-replace per component.

Pairs with [`@velloo/provider-shadcn-upstream`](../provider-shadcn-upstream/),
which fetches vanilla shadcn from upstream at a pinned version and uses
this package's adaptation map to weave canvas-safe behavior in at bundle
time.

## Why this exists

Vanilla shadcn components portal their overlay content to
`document.body`. Inside Velloo's canvas iframes, that portal is
effectively invisible — the iframe's body has nothing for the design to
attach to, and styling pinned to a transformed ancestor breaks the math.

The original approach (in `@velloo/shadcn-snapshot`, now legacy) was to
hand-vendor every shadcn component and modify its source to remove the
portal. That has two real costs: the user's app ends up with a Velloo
fork of shadcn (not vanilla), and every upstream change has to be
re-applied by hand.

This package's approach is different: the bundler keeps the upstream
files unchanged for most components and only swaps in this package's
replacement modules for the canvas-unsafe ones. The user's app
downloads the same vanilla shadcn files via `npx shadcn add`; the
canvas's iframe runs the adapter-wrapped versions. Same component ids
on both sides, byte-identical shadcn in production, canvas-safe
behavior at design time.

## What's in the adaptation map

Listed at `src/adaptation-map.ts`. Two strategies:

| Strategy | When | Examples |
|---|---|---|
| `passthrough` | The upstream is canvas-safe on its own. | Button, Card, Input, Badge, … (most components) |
| `replace` | The upstream uses a Radix Portal or requires heavy runtime state. | Dialog, Popover, DropdownMenu, Tooltip, Select, Sheet, AlertDialog, Sonner, Calendar, Chart, Carousel |

Anything not listed is `passthrough` by default — keeping the map small
to the actual exceptions makes it obvious when a new shadcn release
adds a portal-bearing component that needs adaptation.

## Conventions

- Each replacement module lives at `src/components/<shadcn-id>.tsx`.
  The exports match the upstream shadcn surface name-for-name so a
  swap is drop-in.
- Inline-rendered overlay content carries `data-velloo-inline="true"`
  for audits + selection.
- `pinOpenInDesignMode(props)` is the policy: if the design didn't
  explicitly set `open` or `defaultOpen`, force `open={true}` so the
  Content actually mounts.
