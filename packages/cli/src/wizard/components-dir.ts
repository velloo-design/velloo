import { join, relative, sep } from "node:path";
import { findComponentsDir } from "../scan/detect.ts";

const DEFAULT_COMPONENTS_DIR = "src/components/ui";

/**
 * Where the app keeps its UI components, relative to `appRoot` — found, never
 * asked. A shadcn app says so in `components.json` and the rest keep to a
 * handful of conventions; in a monorepo the directory is under the app that
 * was scanned, not the root. An app with none of them gets the conventional
 * path: only shadcn reads it, and only once components are added there.
 */
export function componentsDirFor(
  appRoot: string,
  scanRoot: string = appRoot,
  inherited?: string | undefined,
): string {
  // A sibling design folder already settled this for the same app — don't let
  // a second folder drift from the first.
  if (inherited) return inherited;
  const atRoot = findComponentsDir(appRoot);
  if (atRoot) return atRoot;
  const nested = scanRoot === appRoot ? undefined : findComponentsDir(scanRoot);
  if (!nested) return DEFAULT_COMPONENTS_DIR;
  return join(relative(appRoot, scanRoot), nested).split(sep).join("/");
}
