import { existsSync } from "node:fs";
import { join } from "node:path";
import type { FrameworkAdapter } from "@velloo/provider";
import { hostAppRootFrom } from "./live/bundle-core.ts";
import type { MutationContext } from "./mutations/context.ts";

/** Whether the design has an app beside it to read: its own stylesheets, or a package. */
export function hostHasApp(ctx: MutationContext): boolean {
  if ((ctx.defaultProvider as FrameworkAdapter).hostStylesheets) return true;
  try {
    const hostRoot = hostAppRootFrom(ctx.folder.root, ctx.folder.config.hostApp);
    return existsSync(join(hostRoot, "package.json"));
  } catch {
    return false;
  }
}
