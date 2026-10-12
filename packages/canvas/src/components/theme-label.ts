/**
 * A theme as the chrome names it. Every design starts with one theme, kept in
 * `theme/default.json`; it reads as a name here, like the ones people give the
 * themes they add.
 */
export function themeLabel(name: string): string {
  return name === "default" ? "Default" : name;
}
