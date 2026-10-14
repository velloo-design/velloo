import { isAbsolute, relative, sep } from "node:path";
import type { ThemeSource } from "@velloo/schema";

/**
 * A `themeSource` record from what an import read: `files` are absolute and
 * come back relative to the app root, in order, once each. A file outside the
 * app is left out — the record is committed with the repo and must not point
 * anywhere else — and the list goes when nothing is left of it.
 */
export function recordThemeSource(
  appRoot: string,
  source: { kind: ThemeSource["kind"]; files?: readonly string[]; library?: string | undefined },
): ThemeSource {
  const files = [
    ...new Set(
      (source.files ?? []).flatMap((file) => {
        const rel = relative(appRoot, file);
        return rel === "" || isAbsolute(rel) || rel.split(sep).includes("..")
          ? []
          : [rel.split(sep).join("/")];
      }),
    ),
  ];
  return {
    kind: source.kind,
    ...(files.length > 0 ? { files } : {}),
    ...(source.library ? { library: source.library } : {}),
  };
}

/** How an app whose theme lives in JavaScript, not a stylesheet, gave the design its theme. */
export interface JavaScriptTheme {
  /** The app-relative module `velloo init` read the theme from. */
  file?: string | undefined;
  /** The library whose own theme the design is on, when the app sets none. */
  defaults?: string | undefined;
}

/**
 * The JavaScript theme a recorded source says the design was read from: a
 * theme object handed to Mantine or MUI, or — for an app that sets none — the
 * library's own. Null for a stylesheet, a DESIGN.md, a preset or no record.
 */
export function javaScriptTheme(source: ThemeSource | undefined): JavaScriptTheme | null {
  if (source?.kind === "mantine" || source?.kind === "mui") return { file: source.files?.[0] };
  if (source?.kind === "library-defaults") return { defaults: source.library };
  return null;
}
