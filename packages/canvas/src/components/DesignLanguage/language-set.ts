/**
 * Whether someone has been through the design-language stage for this design
 * in this browser. Only a hint for what an empty design's first screen says —
 * the language itself is the theme and the rules, which need no flag.
 */
const key = (designName: string) => `velloo:languageSet:${designName}`;

export function readLanguageSet(designName: string | undefined): boolean {
  if (!designName || typeof localStorage === "undefined") return false;
  return localStorage.getItem(key(designName)) === "true";
}

export function markLanguageSet(designName: string | undefined): void {
  if (!designName || typeof localStorage === "undefined") return;
  localStorage.setItem(key(designName), "true");
}
