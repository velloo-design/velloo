/**
 * The shadcn registry component ids this provider installs. Matches
 * the surface the vendored `@velloo/shadcn-snapshot` ships today so
 * Pulse (and any folder created against the legacy provider) renders
 * unchanged when switched to upstream.
 *
 * Ids use shadcn's registry convention (kebab-case, matching the
 * `<name>.json` URL). The bundler converts these to PascalCase
 * component ids (`AlertDialog`, `DropdownMenu`) per the standard
 * shadcn export naming.
 */

export const SHADCN_COMPONENT_IDS = [
  "accordion",
  "alert",
  "alert-dialog",
  "avatar",
  "badge",
  "breadcrumb",
  "button",
  "calendar",
  "card",
  "carousel",
  "chart",
  "checkbox",
  "collapsible",
  "dialog",
  "dropdown-menu",
  "input",
  "label",
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
  "switch",
  "table",
  "tabs",
  "textarea",
  "toggle",
  "toggle-group",
  "tooltip",
] as const;

export type ShadcnComponentId = (typeof SHADCN_COMPONENT_IDS)[number];
