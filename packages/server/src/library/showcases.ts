import type { ComponentNode, Node } from "@velloo/schema";

/**
 * Synthesize a small example tree for a component, used by the Library
 * tile and detail previews. Many shadcn components (Avatar, Alert, Tabs,
 * Card …) need specific children to render meaningfully — a generic
 * `<Button>` with no text or a bare `<Avatar>` looks broken. The map
 * below carries a hand-built tree per id; everything else falls back to
 * a label-style preview that won't crash the renderer.
 */
const SHOWCASES: Record<string, () => ComponentNode> = {
  Button: () => ({ $ref: "Button", props: { children: "Button" } }),
  Badge: () => ({ $ref: "Badge", props: { children: "Badge" } }),
  Heading: () => ({ $ref: "Heading", props: { level: 2, children: "Heading" } }),
  Text: () => ({ $ref: "Text", props: { children: "Body text" } }),
  // Label needs `htmlFor` paired with a real input; rendered standalone it
  // reads as flat text. Pair it with a checkbox so the preview shows the
  // semantic relationship.
  Label: () => ({
    $ref: "Card",
    props: { className: "flex flex-row items-center gap-2 ring-0 shadow-none bg-transparent p-0" },
    children: [
      { $ref: "Checkbox", props: { id: "showcase-label-cb", defaultChecked: true } },
      { $ref: "Label", props: { htmlFor: "showcase-label-cb", children: "Accept terms" } },
    ],
  }),
  Input: () => ({ $ref: "Input", props: { placeholder: "you@company.com" } }),
  Textarea: () => ({ $ref: "Textarea", props: { placeholder: "Write a message…" } }),
  Switch: () => ({ $ref: "Switch", props: { defaultChecked: true } }),
  Checkbox: () => ({ $ref: "Checkbox", props: { defaultChecked: true } }),
  Slider: () => ({ $ref: "Slider", props: { defaultValue: [40], className: "w-40" } }),
  Progress: () => ({ $ref: "Progress", props: { value: 66, className: "w-48" } }),
  Skeleton: () => ({ $ref: "Skeleton", props: { className: "h-6 w-40" } }),
  Separator: () => ({ $ref: "Separator", props: { className: "w-40" } }),
  // Toggle in its default state has no background — looks like plain text.
  // Pressed-with-outline gives the preview a recognizable toggle-button look.
  Toggle: () => ({
    $ref: "Toggle",
    props: { variant: "outline", defaultPressed: true, children: "Bold" },
  }),
  Calendar: () => ({ $ref: "Calendar" }),
  Icon: () => ({ $ref: "Icon", props: { name: "Sparkles", size: 24 } }),
  Placeholder: () => ({ $ref: "Placeholder", props: { kind: "image", aspect: "16/9" } }),
  Divider: () => ({ $ref: "Divider", props: { label: "or" } }),

  Avatar: () => ({
    $ref: "Avatar",
    children: [{ $ref: "AvatarFallback", props: { children: "AB" } }],
  }),
  Alert: () => ({
    $ref: "Alert",
    children: [
      { $ref: "AlertTitle", props: { children: "Heads up!" } },
      {
        $ref: "AlertDescription",
        props: { children: "You can drop this component on a board." },
      },
    ],
  }),
  Card: () => ({
    $ref: "Card",
    props: { className: "p-4 flex flex-col gap-1" },
    children: [
      { $ref: "Text", props: { className: "text-sm font-medium", children: "Card title" } },
      {
        $ref: "Text",
        props: {
          className: "text-xs text-muted-foreground",
          children: "A flexible container for content.",
        },
      },
    ],
  }),
  Tabs: () => ({
    $ref: "Tabs",
    props: { defaultValue: "overview" },
    children: [
      {
        $ref: "TabsList",
        children: [
          { $ref: "TabsTrigger", props: { value: "overview", children: "Overview" } },
          { $ref: "TabsTrigger", props: { value: "activity", children: "Activity" } },
          { $ref: "TabsTrigger", props: { value: "settings", children: "Settings" } },
        ],
      },
    ],
  }),
  Breadcrumb: () => ({
    $ref: "Breadcrumb",
    children: [
      {
        $ref: "BreadcrumbList",
        children: [
          {
            $ref: "BreadcrumbItem",
            children: [{ $ref: "BreadcrumbLink", props: { children: "Home" } }],
          },
          { $ref: "BreadcrumbSeparator" },
          {
            $ref: "BreadcrumbItem",
            children: [{ $ref: "BreadcrumbPage", props: { children: "Library" } }],
          },
        ],
      },
    ],
  }),
  Pagination: () => ({
    $ref: "Pagination",
    children: [
      {
        $ref: "PaginationContent",
        children: [
          { $ref: "PaginationPrevious" },
          {
            $ref: "PaginationItem",
            children: [{ $ref: "PaginationLink", props: { children: "1" } }],
          },
          {
            $ref: "PaginationItem",
            children: [{ $ref: "PaginationLink", props: { isActive: true, children: "2" } }],
          },
          { $ref: "PaginationNext" },
        ],
      },
    ],
  }),
  Accordion: () => ({
    $ref: "Accordion",
    props: { type: "single", collapsible: true, defaultValue: "a" },
    children: [
      {
        $ref: "AccordionItem",
        props: { value: "a" },
        children: [
          { $ref: "AccordionTrigger", props: { children: "What is Velloo?" } },
          { $ref: "AccordionContent", props: { children: "A local design canvas for solo devs." } },
        ],
      },
    ],
  }),
  RadioGroup: () => ({
    $ref: "RadioGroup",
    props: { defaultValue: "a" },
    children: [
      {
        $ref: "Card",
        props: { className: "flex items-center gap-2 ring-0 shadow-none p-0 bg-transparent" },
        children: [
          { $ref: "RadioGroupItem", props: { value: "a", id: "showcase-r1" } },
          { $ref: "Label", props: { htmlFor: "showcase-r1", children: "Option" } },
        ],
      },
    ],
  }),
  ToggleGroup: () => ({
    $ref: "ToggleGroup",
    props: { type: "single", defaultValue: "left" },
    children: [
      { $ref: "ToggleGroupItem", props: { value: "left", children: "Left" } },
      { $ref: "ToggleGroupItem", props: { value: "center", children: "Center" } },
      { $ref: "ToggleGroupItem", props: { value: "right", children: "Right" } },
    ],
  }),
  Select: () => ({
    $ref: "Select",
    children: [
      {
        $ref: "SelectTrigger",
        props: { className: "w-40" },
        children: [{ $ref: "SelectValue", props: { placeholder: "Choose…" } }],
      },
    ],
  }),
  Toaster: () => ({
    $ref: "Toaster",
    props: { position: "bottom-right" },
  }),
  // Headless overlays only render when open / open-state is forced. Showing
  // just the trigger button reads as "this is a click target" without any
  // payload to look at; instead we render a stylized mockup of what the
  // overlay would display when invoked. Same idea for AlertDialog, Sheet,
  // Popover, DropdownMenu, Tooltip below.
  Dialog: () => ({
    $ref: "Card",
    props: { className: "p-4 flex flex-col gap-3 w-72" },
    children: [
      {
        $ref: "Card",
        props: {
          className: "flex flex-col gap-0.5 ring-0 shadow-none bg-transparent p-0",
        },
        children: [
          {
            $ref: "Heading",
            props: { level: 3, className: "text-sm font-semibold", children: "Confirm change" },
          },
          {
            $ref: "Text",
            props: {
              className: "text-xs text-muted-foreground",
              children: "Modal dialog content shown when triggered.",
            },
          },
        ],
      },
      {
        $ref: "Card",
        props: {
          className: "flex flex-row gap-2 justify-end ring-0 shadow-none bg-transparent p-0",
        },
        children: [
          { $ref: "Button", props: { variant: "outline", size: "sm", children: "Cancel" } },
          { $ref: "Button", props: { size: "sm", children: "Save" } },
        ],
      },
    ],
  }),
  AlertDialog: () => ({
    $ref: "Card",
    props: { className: "p-4 flex flex-col gap-3 w-72" },
    children: [
      {
        $ref: "Card",
        props: {
          className: "flex flex-col gap-0.5 ring-0 shadow-none bg-transparent p-0",
        },
        children: [
          {
            $ref: "Heading",
            props: { level: 3, className: "text-sm font-semibold", children: "Delete file?" },
          },
          {
            $ref: "Text",
            props: {
              className: "text-xs text-muted-foreground",
              children: "This action can't be undone.",
            },
          },
        ],
      },
      {
        $ref: "Card",
        props: {
          className: "flex flex-row gap-2 justify-end ring-0 shadow-none bg-transparent p-0",
        },
        children: [
          { $ref: "Button", props: { variant: "outline", size: "sm", children: "Cancel" } },
          { $ref: "Button", props: { variant: "destructive", size: "sm", children: "Delete" } },
        ],
      },
    ],
  }),
  Popover: () => ({
    $ref: "Card",
    props: { className: "p-3 flex flex-col gap-2 w-56" },
    children: [
      {
        $ref: "Text",
        props: { className: "text-xs font-medium", children: "Popover content" },
      },
      {
        $ref: "Text",
        props: {
          className: "text-[10px] text-muted-foreground",
          children: "Anchored to a trigger.",
        },
      },
    ],
  }),
  DropdownMenu: () => ({
    $ref: "Card",
    props: {
      className: "p-1 flex flex-col gap-0.5 w-44 ring-0",
    },
    children: [
      {
        $ref: "Card",
        props: {
          className: "px-2 py-1 text-sm rounded-sm ring-0 shadow-none bg-transparent",
        },
        children: [{ $ref: "Text", props: { className: "text-sm", children: "Profile" } }],
      },
      {
        $ref: "Card",
        props: {
          className: "px-2 py-1 text-sm rounded-sm bg-muted ring-0 shadow-none",
        },
        children: [{ $ref: "Text", props: { className: "text-sm", children: "Settings" } }],
      },
      { $ref: "Separator", props: { className: "my-1" } },
      {
        $ref: "Card",
        props: {
          className:
            "px-2 py-1 text-sm rounded-sm text-destructive ring-0 shadow-none bg-transparent",
        },
        children: [
          { $ref: "Text", props: { className: "text-sm text-destructive", children: "Log out" } },
        ],
      },
    ],
  }),
  Tooltip: () => ({
    $ref: "Card",
    props: {
      className:
        "px-2.5 py-1.5 rounded-md bg-foreground text-background text-xs font-medium ring-0",
    },
    children: [{ $ref: "Text", props: { className: "text-xs", children: "Helpful hint" } }],
  }),
  Sheet: () => ({
    $ref: "Card",
    props: {
      className: "p-4 flex flex-col gap-3 w-64 border-l-2 border-l-foreground/20",
    },
    children: [
      {
        $ref: "Heading",
        props: { level: 3, className: "text-sm font-semibold", children: "Slide-in panel" },
      },
      {
        $ref: "Text",
        props: {
          className: "text-xs text-muted-foreground",
          children: "Drawer mounted on a screen edge.",
        },
      },
    ],
  }),
  Collapsible: () => ({
    $ref: "Collapsible",
    props: { defaultOpen: true },
    children: [
      {
        $ref: "CollapsibleTrigger",
        children: [
          { $ref: "Button", props: { variant: "outline", size: "sm", children: "Toggle" } },
        ],
      },
      {
        $ref: "CollapsibleContent",
        children: [
          {
            $ref: "Card",
            props: {
              className: "mt-2 p-2 ring-0 shadow-none bg-muted text-xs",
            },
            children: [
              {
                $ref: "Text",
                props: { className: "text-xs", children: "Hidden content revealed." },
              },
            ],
          },
        ],
      },
    ],
  }),
  Carousel: () => ({
    $ref: "Carousel",
    props: { className: "w-56" },
    children: [
      {
        $ref: "CarouselContent",
        children: [
          {
            $ref: "CarouselItem",
            children: [
              {
                $ref: "Card",
                props: { className: "p-6 bg-primary text-primary-foreground" },
                children: [
                  {
                    $ref: "Text",
                    props: { className: "text-sm font-medium", children: "Slide 1" },
                  },
                ],
              },
            ],
          },
        ],
      },
      { $ref: "CarouselPrevious" },
      { $ref: "CarouselNext" },
    ],
  }),
  ScrollArea: () => ({
    $ref: "ScrollArea",
    props: { className: "h-24 w-48 rounded-md border border-border p-2" },
    children: [
      {
        $ref: "Card",
        props: {
          className: "flex flex-col gap-1 ring-0 shadow-none bg-transparent p-0",
        },
        children: Array.from({ length: 6 }, (_, i) => ({
          $ref: "Text" as const,
          props: { className: "text-xs", children: `Item ${i + 1}` },
        })),
      },
    ],
  }),
  // Uses only intersection components (Card + Text) — Badge is shadcn-only,
  // and Layer exists in every shipped provider, so its showcase has to
  // render under every registry.
  Layer: () => ({
    $ref: "Card",
    props: { className: "relative h-24 w-40 bg-muted rounded-md overflow-hidden" },
    children: [
      {
        $ref: "Layer",
        props: { top: "1rem", left: "1rem" },
        children: [
          {
            $ref: "Card",
            props: {
              className:
                "px-2 py-0.5 rounded-full bg-primary text-primary-foreground ring-0 shadow-none",
            },
            children: [
              {
                $ref: "Text",
                props: { className: "text-xs font-medium", children: "Layer" },
              },
            ],
          },
        ],
      },
    ],
  }),
  Gradient: () => ({
    $ref: "Gradient",
    props: { preset: "sunset", className: "h-20 w-full rounded-md" },
  }),
  Image: () => ({
    $ref: "Image",
    props: {
      src: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'><rect width='16' height='9' fill='%23ddd'/></svg>",
      aspect: "16/9",
      fill: false,
    },
  }),
  SVG: () => ({
    $ref: "SVG",
    props: {
      viewBox: "0 0 24 24",
      content:
        "<circle cx='12' cy='12' r='8' fill='currentColor' opacity='0.2'/><circle cx='12' cy='12' r='4' fill='currentColor'/>",
      className: "h-12 w-12 text-primary",
    },
  }),
  Chart: () => ({
    $ref: "Chart",
    props: {
      kind: "line",
      data: [
        { x: 0, y: 4 },
        { x: 1, y: 6 },
        { x: 2, y: 5 },
        { x: 3, y: 9 },
        { x: 4, y: 7 },
        { x: 5, y: 12 },
      ],
      className: "h-20 w-full",
    },
  }),
};

/**
 * Build a showcase tree for the given component id. Optional `propOverrides`
 * lets the detail page render variant×size combinations by patching only the
 * top-level component's props (the children stay intact).
 *
 * Special-case: when an icon-size is requested (size === "icon" or
 * "icon-*"), swap text children for a single Icon so the preview reads
 * as the icon-button it's meant to be — otherwise the text gets clipped
 * into "utto" and the matrix looks broken.
 */
export function buildShowcaseTree(
  componentRef: string,
  propOverrides?: Record<string, unknown>,
): Node {
  const isIconSize =
    typeof propOverrides?.size === "string" && propOverrides.size.startsWith("icon");

  const builder = SHOWCASES[componentRef];
  if (builder) {
    const tree = builder();
    if (propOverrides && Object.keys(propOverrides).length > 0) {
      tree.props = { ...(tree.props ?? {}), ...propOverrides };
    }
    if (isIconSize && componentRef === "Button") {
      delete tree.props?.children;
      tree.children = [{ $ref: "Icon", props: { name: "Plus", size: 14 } }];
    }
    return tree;
  }
  return {
    $ref: componentRef,
    props: { children: componentRef, ...(propOverrides ?? {}) },
  };
}
