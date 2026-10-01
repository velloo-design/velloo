import { REGISTRY_FILES } from "@velloo/shadcn-snapshot/registry-files";
import { type CodegenTarget, frameworkTarget } from "../emit-code/target.ts";

/**
 * The shadcn codegen target, for cases about shadcn specifically.
 *
 * The server builds every framework's target from its provider manifest; this
 * reproduces shadcn's from the same `registryName` extraction the manifest
 * carries, so a codegen test needs neither a provider nor a folder on disk.
 * Nothing in codegen's own source knows what shadcn is — which is the point:
 * these cases pass a target in like any other framework's.
 */
export function shadcnTarget(): CodegenTarget {
  return frameworkTarget(
    Object.entries(REGISTRY_FILES).map(([id, item]) => ({ id, install: item })),
  );
}
