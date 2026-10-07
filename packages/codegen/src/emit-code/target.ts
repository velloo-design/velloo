/**
 * How a component id becomes code.
 *
 * A `CodegenTarget` is one framework's half of the emit contract: for every
 * component id it owns, the JSX identifier the emitted code names and how the
 * agent gets that component into their app. Every framework has one and they
 * sit on the same footing — shadcn's components install from its registry, MUI's
 * import from `@mui/material`, antd's from `"antd"` under their real dotted
 * exports — so none of them is the behavior the others opt out of. The targets
 * themselves are built from each provider's manifest (see the server's
 * `codegenTargetFor`); nothing framework-specific is spelled out in here.
 *
 * `emitTree` resolves a name down an ordered chain: the screen's framework
 * target first, then the velloo primitives (`../velloo-primitives.ts`) that
 * every framework shares. So a MUI screen's `Card` and `Box` are MUI's, while
 * its `Heading` and `Icon` are velloo's own helpers, lowered the same way in
 * every framework.
 */

/** How the agent gets a component the emitted JSX names. */
export type Provision =
  /** Install the library's own unit as a file — for shadcn, `npx shadcn@latest add <item>`. */
  | { kind: "install"; item: string }
  /**
   * The app already has the library's unit as a file — imported from the
   * components alias like an install would be, with nothing left to provision.
   */
  | { kind: "present" }
  /** Import it from a package the app depends on — MUI's `@mui/material`. */
  | { kind: "package"; module: string }
  /**
   * The app has to supply it. A velloo composition helper (Gradient, SVG,
   * Image, Layer, Divider) carries real runtime logic, so emit keeps its
   * identifier rather than lowering it or pointing at a package; and a
   * framework component whose manifest names neither a unit to install nor a
   * package to import is one emit cannot say where to get.
   */
  | { kind: "author" };

/** Emit the identifier as-is; `provision` says how the agent obtains it. */
interface ComponentEmit {
  kind: "component";
  /** JSX identifier, which may be a dotted member path (`Typography.Title`). */
  jsxName: string;
  provision?: Provision | undefined;
  /** Design prop name → the framework's own name for it in emitted code. */
  nativeProps?: Readonly<Record<string, string>> | undefined;
}

/**
 * Where a lowering lands, for the ones whose element depends on it. The runtime
 * components read the same fact from React context, so the code and the canvas
 * pick the same tag.
 */
interface LowerScope {
  /** Beneath a velloo `Text`: a run of that paragraph, not a paragraph of its own. */
  inText: boolean;
}

/**
 * Inline the component as a plain HTML element with Tailwind classes, so the
 * app needs no extra file. `lower` decides the tag and classes from the node's
 * props; `consumed` are the props it reads and the emit must not also print.
 */
interface LoweredEmit {
  kind: "lowered";
  consumed?: readonly string[] | undefined;
  /** Everything beneath this lowering is lowered with `scope.inText`. */
  text?: boolean | undefined;
  lower(
    props: Record<string, unknown>,
    scope: LowerScope,
  ): {
    tag: string;
    extraClasses: string;
    /** Spliced in when the node doesn't set them (role, aria-label, …). */
    extraProps?: Record<string, unknown>;
    /** Text child used when the node has none of its own. */
    fallbackChild?: string | undefined;
  };
}

/**
 * Inline the component as a plain HTML element with an inline `style` object —
 * the `style`-channel counterpart of {@link LoweredEmit}, for a folder with no
 * CSS framework. The node's authored `style` merges over these defaults.
 */
interface InlineEmit {
  kind: "inline";
  consumed?: readonly string[] | undefined;
  /** Everything beneath this lowering is lowered with `scope.inText`. */
  text?: boolean | undefined;
  lower(
    props: Record<string, unknown>,
    scope: LowerScope,
  ): {
    tag: string;
    style: Record<string, string | number>;
    /** Spliced in when the node doesn't set them (`type="button"`, …). */
    extraProps?: Record<string, string | number>;
  };
}

/**
 * Emit a JSX element whose name is computed from the node's props — `Icon`'s
 * `name` selects which lucide component to render. The import comes from an
 * external package the app already depends on.
 */
interface DynamicEmit {
  kind: "dynamic";
  consumed?: readonly string[] | undefined;
  /** Resolve the JSX component name + any default classes from node props. */
  resolve(props: Record<string, unknown>): { jsxName: string; extraClasses: string };
}

/** Everything a target can say a component id emits as. */
export type Emit = ComponentEmit | LoweredEmit | InlineEmit | DynamicEmit;

export interface CodegenTarget {
  /** How this framework emits `id`, or null when it doesn't own the name. */
  componentFor(id: string): Emit | null;
}

/** One component a framework owns, as `frameworkTarget` consumes it. */
export interface TargetComponent {
  id: string;
  /** JSX identifier, when it differs from the id (`TypographyTitle` ⇒ `Typography.Title`). */
  jsxName?: string | undefined;
  /** The library's installable unit for this component, when it ships as a file. */
  install?: string | undefined;
  /** The app already has the `install` unit, so it needs no provisioning. */
  installed?: boolean | undefined;
  /** The package it imports from, for a library the app installs whole. */
  module?: string | undefined;
  /** Design prop name → the framework's own name for it (`as` ⇒ `component`). */
  nativeProps?: Readonly<Record<string, string>> | undefined;
}

/**
 * A target over a fixed set of components — every framework's shape, since each
 * one's catalog comes from its manifest. Ids outside the set fall through, so a
 * framework that ships no `Icon` still gets velloo's lucide one.
 */
export function frameworkTarget(components: Iterable<TargetComponent>): CodegenTarget {
  const byId = new Map<string, ComponentEmit>();
  for (const { id, jsxName, install, installed, module, nativeProps } of components) {
    // A component the library installs as a file into the app is not also
    // imported from a package, so `install` wins when a library declares both.
    const provision: Provision = install
      ? installed
        ? { kind: "present" }
        : { kind: "install", item: install }
      : module
        ? { kind: "package", module }
        : { kind: "author" };
    byId.set(id, {
      kind: "component",
      jsxName: jsxName ?? id,
      provision,
      ...(nativeProps ? { nativeProps } : {}),
    });
  }
  return { componentFor: (id) => byId.get(id) ?? null };
}
