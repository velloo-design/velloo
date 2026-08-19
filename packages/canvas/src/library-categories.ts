/**
 * Curated grouping of shadcn components into user-facing categories.
 * The on-disk manifest only carries the coarse "ui" / "typography"
 * split; this file is what the Library sidebar and home actually
 * render. Sub-pieces of compound components (TabsList, AvatarFallback,
 * BreadcrumbItem …) are intentionally omitted — they belong to their
 * parent's tree, not as standalone library entries.
 */
export interface LibraryCategory {
  id: string;
  label: string;
  components: string[];
}

export const LIBRARY_CATEGORIES: LibraryCategory[] = [
  { id: "actions", label: "Actions", components: ["Button", "Toggle", "ToggleGroup"] },
  {
    id: "forms",
    label: "Forms & Inputs",
    components: [
      "Input",
      "Textarea",
      "Label",
      "Checkbox",
      "RadioGroup",
      "Switch",
      "Slider",
      "Select",
      "Calendar",
    ],
  },
  {
    id: "display",
    label: "Display",
    components: ["Avatar", "Badge", "Card", "Skeleton", "Image", "Placeholder"],
  },
  {
    id: "feedback",
    label: "Feedback",
    components: ["Alert", "Progress", "Toaster"],
  },
  {
    id: "navigation",
    label: "Navigation",
    components: ["Tabs", "Breadcrumb", "Pagination", "Accordion"],
  },
  {
    id: "overlays",
    label: "Overlays",
    components: [
      "Dialog",
      "AlertDialog",
      "Sheet",
      "Popover",
      "DropdownMenu",
      "Tooltip",
      "Collapsible",
    ],
  },
  {
    id: "layout",
    label: "Layout",
    components: ["ScrollArea", "Separator", "Divider", "Carousel", "Layer"],
  },
  { id: "typography", label: "Typography", components: ["Heading", "Text"] },
  { id: "visuals", label: "Visuals", components: ["Icon", "Gradient", "SVG", "Chart", "Image"] },
];

/** Quick lookup: component id → its category label. */
export function categoryForComponent(componentId: string): string | null {
  for (const cat of LIBRARY_CATEGORIES) {
    if (cat.components.includes(componentId)) return cat.label;
  }
  return null;
}
