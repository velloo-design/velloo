import type { ComponentProvider, Manifest } from "@velloo/provider";
import { isComponentNode, type Node, pascalizeIconName, type Screen } from "@velloo/schema";
import { providerForScreen } from "../extensions/registry.ts";
import type { MutationContext } from "./context.ts";
import { nearestRefs } from "./errors.ts";

/**
 * Advisory prop validation against the manifest. Mutations never block
 * on these — designs may legitimately carry pass-through DOM props —
 * but a typo'd prop name or an out-of-range enum value otherwise fails
 * silently at render time (e.g. a Chart given `type` instead of `kind`
 * SSRs NaN geometry). The MCP layer attaches the warnings to successful
 * mutation results so the agent can self-correct in the same turn.
 */

/**
 * Props any component legitimately accepts. Deliberately small: DOM
 * passthrough components (Input, etc.) declare zero manifest props and
 * skip validation entirely, so element-specific names like `type` or
 * `placeholder` don't need blanket exemptions — and a Chart given
 * `type` instead of `kind` still warns.
 */
const UNIVERSAL_PROPS = new Set(["className", "children", "id", "style", "title", "role"]);

/**
 * Brand glyphs lucide removed (they live in `lucide-static`/`simple-icons`
 * now). These are exactly the names people reach for, so a generic "closest
 * match" suggestion (GitGraph for Github) misleads — point at the real fix.
 */
const REMOVED_BRAND_ICONS = new Set([
  "Github",
  "Gitlab",
  "Twitter",
  "Facebook",
  "Linkedin",
  "Instagram",
  "Youtube",
  "Twitch",
  "Slack",
  "Figma",
  "Chrome",
  "Codepen",
  "Dribbble",
  "Trello",
  "Framer",
  "Discord",
]);

const manifestCache = new WeakMap<ComponentProvider, Promise<Manifest>>();

function manifestFor(provider: ComponentProvider): Promise<Manifest> {
  let cached = manifestCache.get(provider);
  if (!cached) {
    cached = provider.loadManifest().catch(() => [] as Manifest);
    manifestCache.set(provider, cached);
  }
  return cached;
}

function isSubstitution(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (typeof (value as { $param?: unknown }).$param === "string" ||
      typeof (value as { $if?: unknown }).$if === "string")
  );
}

/** Warnings for one component's props. Empty array = all clear. */
export async function propWarnings(
  ctx: MutationContext,
  screen: Screen,
  ref: string,
  props: Record<string, unknown>,
): Promise<string[]> {
  const provider = providerForScreen(screen, ctx.providers, ctx.defaultProvider);
  const manifest = await manifestFor(provider);
  const descriptor = manifest.find((c) => c.id === ref);
  const extension = ctx.folder.config.extensions?.[ref];
  const known = descriptor?.props ?? extension?.props;
  // No descriptor, or a descriptor with no declared props (DOM
  // passthrough components like Input) — nothing to validate against.
  if (!known || known.length === 0) return [];

  const warnings: string[] = [];
  const knownNames = known.map((p) => p.name);

  for (const [key, value] of Object.entries(props)) {
    if (UNIVERSAL_PROPS.has(key) || key.startsWith("data-") || key.startsWith("aria-")) continue;
    if (isSubstitution(value)) continue;

    const prop = known.find((p) => p.name === key);
    if (!prop) {
      const near = nearestRefs(key, knownNames, 3).join(", ");
      warnings.push(`${ref}: unknown prop "${key}"${near ? ` — closest known: ${near}` : ""}`);
      continue;
    }
    if (prop.control === "icon" && prop.enumValues && typeof value === "string") {
      // Icon names resolve PascalCase or kebab-case (normalized at render
      // time) — warn only when neither form matches a lucide export,
      // because the canvas then silently falls back to a "?" glyph.
      const names = prop.enumValues.map(String);
      const pascal = pascalizeIconName(value);
      if (!names.includes(value) && !names.includes(pascal)) {
        // Brand glyph removed from lucide → point at SVG/Image, not a bogus
        // "closest match"; otherwise suggest the nearest real icon names.
        let suffix: string;
        if (REMOVED_BRAND_ICONS.has(pascal)) {
          suffix =
            " — lucide dropped brand glyphs; use the `SVG` component (or `Image`) for a logo";
        } else {
          const near = nearestRefs(pascal, names, 3).join(", ");
          suffix = near ? `; closest: ${near}` : "";
        }
        warnings.push(
          `${ref}: "${key}" = ${JSON.stringify(value)} doesn't match any lucide icon — renders as the fallback "?"${suffix}`,
        );
      }
    } else if (prop.control === "enum" && prop.enumValues && typeof value === "string") {
      if (!prop.enumValues.map(String).includes(value)) {
        warnings.push(
          `${ref}: "${key}" = ${JSON.stringify(value)} is not one of [${prop.enumValues.join(", ")}]`,
        );
      }
    } else if (
      prop.control === "boolean" &&
      typeof value !== "boolean" &&
      typeof value !== "object"
    ) {
      warnings.push(`${ref}: "${key}" expects a boolean, got ${JSON.stringify(value)}`);
    } else if (
      prop.control === "number" &&
      typeof value !== "number" &&
      typeof value !== "object"
    ) {
      warnings.push(`${ref}: "${key}" expects a number, got ${JSON.stringify(value)}`);
    }
  }
  return warnings;
}

/** Walk a subtree, collecting prop warnings for every component node. */
export async function propWarningsForTree(
  ctx: MutationContext,
  screen: Screen,
  root: Node,
  basePath: number[] = [],
): Promise<string[]> {
  const out: string[] = [];
  async function walk(node: Node, path: number[]): Promise<void> {
    if (!isComponentNode(node)) return;
    if (node.props) {
      const w = await propWarnings(ctx, screen, node.$ref, node.props);
      const prefix = path.length > 0 ? `[${path.join(".")}] ` : "";
      out.push(...w.map((msg) => `${prefix}${msg}`));
    }
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
      const child = node.children?.[i];
      if (child) await walk(child, [...path, i]);
    }
  }
  await walk(root, basePath);
  return out;
}
