import { type CodegenTarget, frameworkTarget } from "@velloo/codegen";
import {
  type ComponentProvider,
  type CssFramework,
  type FrameworkAdapter,
  styleChannelOf,
} from "@velloo/provider";
import type { Screen, Snippet } from "@velloo/schema";
import { providerForScreen } from "./extensions/registry.ts";

/**
 * What emitting a screen needs to know about its framework — resolved in one
 * place so the MCP tool, the CLI's `velloo emit` and the tests can't drift into
 * three different answers.
 */

/**
 * A provider's codegen target, read off its own manifest. Every framework gets
 * one on the same terms: the ids it owns are the ones it declares (`source` is
 * anything but `"velloo"` — the reused helpers belong to the velloo primitives),
 * each component's JSX identifier is its `nativeExport` when the two differ, and
 * provisioning is its `registryName` when the library ships components as
 * installable files (shadcn) or its `codegenModule` when the app installs the
 * library whole (MUI, antd, chakra).
 *
 * A provider whose every component is a velloo primitive (`none`) owns nothing
 * here, which is the right answer rather than a special case: its `Card` and
 * `Button` lower to plain HTML like the rest of the velloo set.
 */
export async function codegenTargetFor(provider: ComponentProvider): Promise<CodegenTarget> {
  const module = (provider as FrameworkAdapter).codegenModule;
  const manifest = await provider.loadManifest();
  return frameworkTarget(
    manifest
      .filter((c) => c.source !== "velloo")
      .map((c) => ({
        id: c.id,
        ...(c.nativeExport ? { jsxName: c.nativeExport } : {}),
        ...(c.registryName ? { install: c.registryName } : {}),
        ...(module ? { module } : {}),
      })),
  );
}

export interface EmitFrameworkContext {
  target: CodegenTarget;
  /** The velloo primitives lower to inline `style` rather than Tailwind classes. */
  inlineStyle: boolean;
  /** Tailwind class diagnostics apply — the screen's classes are utilities. */
  tailwind: boolean;
  /** The adapter emits native markup instead of JSX (`emitHtml`). */
  html: boolean;
}

/** Resolve a screen or snippet's framework context for emit. */
export async function emitFrameworkContextFor(
  thing: Pick<Screen, "library"> | Pick<Snippet, "library">,
  providers: Record<string, ComponentProvider>,
  defaultProvider: ComponentProvider,
  folderCss?: CssFramework,
): Promise<EmitFrameworkContext> {
  const provider = providerForScreen(thing, providers, defaultProvider);
  const channel = styleChannelOf(provider, folderCss).kind;
  return {
    target: await codegenTargetFor(provider),
    inlineStyle: channel === "style",
    tailwind: channel === "tailwind-classname",
    html: (provider as FrameworkAdapter).codegenFormat === "html",
  };
}
