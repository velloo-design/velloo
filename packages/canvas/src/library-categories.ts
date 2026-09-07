/**
 * Library browsing shelves, derived from the loaded manifest.
 *
 * This used to be a hand-kept list of component ids per category, which meant
 * the sidebar showed only what someone had remembered to add: a snapshot
 * refresh took the library from 143 to 292 components and every one of the 20
 * new families was unbrowsable, with nothing failing to say so. Descriptors now
 * carry their own `group`/`family`, so the shelves are whatever the library
 * says they are, and an unrecognized group still lands in a visible bucket.
 *
 * Sub-pieces of a compound (TabsList, FieldLabel, BreadcrumbItem …) stay out of
 * the listing: they belong to their family's tree, not beside it as peers.
 */
import { COMPONENT_GROUPS, type ComponentDescriptor, groupLabel } from "@velloo/provider";

export interface LibraryCategory {
  id: string;
  label: string;
  components: string[];
}

/** Family roots only — an entry whose `family` is itself, or which has none. */
function isFamilyRoot(descriptor: ComponentDescriptor): boolean {
  return descriptor.family === undefined || descriptor.family === descriptor.id;
}

const UNGROUPED_ID = "other";

export function libraryCategories(
  components: readonly ComponentDescriptor[] | null | undefined,
): LibraryCategory[] {
  if (!components || components.length === 0) return [];
  const byGroup = new Map<string, string[]>();
  for (const descriptor of components) {
    if (!isFamilyRoot(descriptor)) continue;
    const id = descriptor.group ?? UNGROUPED_ID;
    byGroup.set(id, [...(byGroup.get(id) ?? []), descriptor.id]);
  }
  const order = [...COMPONENT_GROUPS.map((g) => g.id), UNGROUPED_ID];
  return [...byGroup.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([id, ids]) => ({
      id,
      label: groupLabel(id === UNGROUPED_ID ? undefined : (id as ComponentDescriptor["group"])),
      components: [...ids].sort((a, b) => a.localeCompare(b)),
    }));
}

/** Quick lookup: component id → its shelf label, for the detail breadcrumb. */
export function categoryForComponent(
  components: readonly ComponentDescriptor[] | null | undefined,
  componentId: string,
): string | null {
  const descriptor = components?.find((c) => c.id === componentId);
  if (!descriptor) return null;
  // A sub-piece shows its family's shelf: FieldLabel reads as "Forms & Inputs".
  return groupLabel(descriptor.group);
}
