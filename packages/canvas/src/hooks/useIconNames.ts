import { useMemo } from "react";
import { useCanvas } from "../store.ts";

/**
 * The lucide name list, read off the manifest's Icon component (its `name`
 * prop enumerates every icon). The option source for icon-kind ValueFields.
 * Empty until `loadComponents()` has populated the manifest.
 */
export function useIconNames(): string[] {
  const components = useCanvas((s) => s.components);
  return useMemo(() => {
    const name = components?.find((c) => c.id === "Icon")?.props.find((p) => p.name === "name");
    return Array.isArray(name?.enumValues) ? (name.enumValues as string[]) : [];
  }, [components]);
}
