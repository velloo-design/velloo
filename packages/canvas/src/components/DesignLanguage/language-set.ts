/**
 * Whether someone has been through the design-language stage for this design
 * in this browser. Only a hint for what an empty design's first screen says —
 * the language itself is the theme and the rules, which need no flag.
 *
 * Keyed by the design's id, never its name. Names repeat — every repo's first
 * design is called after its folder, and canvases share `localhost` — so a
 * name-keyed flag told a design created a minute ago that its language was
 * already set, because another design of that name once was. A design with no
 * id gets no hint at all rather than one it might be borrowing.
 */
const key = (folderId: string) => `velloo:languageSet:id:${folderId}`;

export function readLanguageSet(folderId: string | null | undefined): boolean {
  if (!folderId || typeof localStorage === "undefined") return false;
  return localStorage.getItem(key(folderId)) === "true";
}

export function markLanguageSet(folderId: string | null | undefined): void {
  if (!folderId || typeof localStorage === "undefined") return;
  localStorage.setItem(key(folderId), "true");
}
