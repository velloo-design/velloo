/** Canonical canvas tab format, shared by loading and board-selection states. */
export function formatBrowserTitle(designName?: string | null, boardName?: string | null): string {
  const parts = [designName, boardName].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? `${parts.join(" · ")} - velloo` : "velloo";
}
