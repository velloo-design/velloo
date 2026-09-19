import { dynamicIconName, REMOVED_BRAND_ICONS } from "@velloo/codegen";
import type { ComponentProvider, Manifest } from "@velloo/provider";
import {
  isComponentNode,
  type Node,
  pascalizeIconName,
  type RepoComponentRef,
  repoKey,
  type Screen,
} from "@velloo/schema";
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
  repo?: RepoComponentRef,
): Promise<string[]> {
  if (repo) return repoPropWarnings(ctx, ref, props, repo);
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

/**
 * Children given to an app component that declares props but not `children`
 * (a `TextInput` wraps a void `<input>`, which throws on them). Only when props
 * are known: a component that spreads its props would otherwise read as one.
 */
async function repoChildrenWarning(
  ctx: MutationContext,
  ref: string,
  repo: RepoComponentRef,
): Promise<string | null> {
  const catalog = ctx.repo ? await ctx.repo.catalog().catch(() => null) : null;
  const entry = catalog?.byKey.get(repoKey(repo));
  if (!entry || entry.acceptsChildren || entry.props.length === 0) return null;
  return `${ref} doesn't take children; it may drop or throw on them. Pass content through its props instead.`;
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
    const prefix = path.length > 0 ? `[${path.join(".")}] ` : "";
    if (node.props) {
      const w = await propWarnings(ctx, screen, node.$ref, node.props, node.$repo);
      out.push(...w.map((msg) => `${prefix}${msg}`));
    }
    const given = (node.children?.length ?? 0) > 0 || node.props?.children !== undefined;
    if (node.$repo && given) {
      const w = await repoChildrenWarning(ctx, node.$ref, node.$repo);
      if (w) out.push(`${prefix}${w}`);
    }
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
      const child = node.children?.[i];
      if (child) await walk(child, [...path, i]);
    }
  }
  await walk(root, basePath);
  return out;
}

/**
 * Design-time check for the dynamic-icon-param footgun: an Icon whose `name`
 * is a `$param`/`$if` substitution renders fine on the canvas, but emit_code
 * lowers it to a single static glyph (a lucide name must be a literal JSX
 * tag). propWarnings deliberately skips substitution values, so this is a
 * separate, pure walk — attached to add_snippet/update_snippet results so
 * the agent reshapes the param while the snippet is still being designed.
 */
export function dynamicIconWarningsForTree(root: Node): string[] {
  const out: string[] = [];
  const asComponent = (v: unknown): Node | null =>
    v !== null && typeof v === "object" && isComponentNode(v as Node) ? (v as Node) : null;
  function walk(node: Node, path: number[]): void {
    if (!isComponentNode(node)) return;
    const dyn = dynamicIconName(node);
    if (dyn) {
      const prefix = path.length > 0 ? `[${path.join(".")}] ` : "";
      out.push(
        `${prefix}Icon "name" is fed by ${dyn} — emit_code lowers a dynamic icon name to a single static glyph. If each instance needs its own icon, declare a \`node\` param instead (it emits as a {slot} the caller fills).`,
      );
    }
    // Icon nodes also live in a node-shaped `children` prop (a single node,
    // or rich-text runs) — walk those like real children.
    const propChildren = node.props?.children;
    if (Array.isArray(propChildren)) {
      for (let i = 0; i < propChildren.length; i++) {
        const child = asComponent(propChildren[i]);
        if (child) walk(child, [...path, i]);
      }
    } else {
      const single = asComponent(propChildren);
      if (single) walk(single, [...path, 0]);
    }
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
      const child = node.children?.[i];
      if (child) walk(child, [...path, i]);
    }
  }
  walk(root, []);
  return out;
}

/**
 * A repository component's props are checked against what its declarations
 * say — but only where they say it. A name missing from the extracted list is
 * not flagged: most design systems inherit props from bases we don't expand
 * (Mantine's style props), and a false "unknown prop" teaches agents to drop
 * real props. Enum values and non-serializable props are flagged.
 */
async function repoPropWarnings(
  ctx: MutationContext,
  ref: string,
  props: Record<string, unknown>,
  repo: RepoComponentRef,
): Promise<string[]> {
  const catalog = ctx.repo ? await ctx.repo.catalog().catch(() => null) : null;
  const entry = catalog?.byKey.get(repoKey(repo));
  if (!entry) return [];
  const warnings: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (isSubstitution(value)) continue;
    const prop = entry.props.find((p) => p.name === key);
    if (!prop) continue;
    if (!prop.serializable) {
      warnings.push(`${ref}: "${key}" ${prop.constraint ?? "takes code, not data"}`);
    } else if (
      prop.control === "enum" &&
      prop.enumValues &&
      typeof value === "string" &&
      !prop.enumValues.map(String).includes(value)
    ) {
      warnings.push(
        `${ref}: "${key}" = ${JSON.stringify(value)} is not one of [${prop.enumValues.join(", ")}]`,
      );
    }
  }
  return warnings;
}
