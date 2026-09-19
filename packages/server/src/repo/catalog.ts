import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ComponentGroup } from "@velloo/provider";
import {
  type Config,
  type HostApp,
  type RepoComponentOverride,
  type RepoComponentRef,
  RepoComponentsManifestSchema,
  repoKey,
} from "@velloo/schema";
import { aliasPairs, hostAppRootFrom } from "../live/bundle-core.ts";
import {
  type DeclarationIndex,
  emptyIndex,
  indexLocalDeclarations,
  indexPackageDeclarations,
  propsFor,
  type RepoPropDescriptor,
  variantPropsFor,
} from "./declarations.ts";
import {
  type DiscoveredComponent,
  type DiscoveryResult,
  discoverRepoComponents,
} from "./discover.ts";
import { type PreviewEntry, resolvePreviewEntry } from "./preview.ts";
import { type FrameworkRecipe, recipeForSpecifier, recipesForHost } from "./recipes/index.ts";
import { collectStoryStates, type PreviewState } from "./stories.ts";

/**
 * The repository component catalog: what the app's own code renders, with
 * extracted props, preview states and provenance, laid over the active
 * provider rather than replacing it. Built lazily per host app and cached
 * until one of the files it read changes.
 */

export interface RepoCatalogEntry {
  /**
   * What agents write: the JSX name, qualified (`Mantine.Button`) only when the
   * name would otherwise collide with a provider component, helper, extension
   * or another repository component.
   */
  id: string;
  /** The JSX name the app writes — what the node's `$ref` and emitted code use. */
  name: string;
  identity: RepoComponentRef;
  key: string;
  source: "package" | "local";
  packageName?: string | undefined;
  /** Compound root: `Tabs` for `Tabs.List`. */
  family: string;
  group?: ComponentGroup | undefined;
  description?: string | undefined;
  props: RepoPropDescriptor[];
  acceptsChildren: boolean;
  /** Compound parts the family declares (`List`, `Tab`, `Panel`). */
  parts?: string[] | undefined;
  states: PreviewState[];
  /** Host-relative call sites, most useful first. */
  provenance: string[];
  /** Built-in framework recipe that speaks for this component. */
  recipe?: string | undefined;
  /** Style props the component accepts per instance. */
  styleProps: string[];
  /** Why the id was qualified, when it was. */
  qualifiedBecause?: string | undefined;
  /** Found only as a part of a family the app uses, not at a call site. */
  viaFamily?: boolean | undefined;
  proxy?: string | undefined;
}

export interface RepoAppSummary {
  app?: string | undefined;
  hostRoot: string;
  recipes: string[];
  preview: { kind: PreviewEntry["kind"]; label: string };
  wrappers: DiscoveryResult["wrappers"];
  globalStyles: DiscoveryResult["globalStyles"];
  entries: string[];
  skipped: DiscoveryResult["skipped"];
}

export interface RepoCatalog {
  entries: RepoCatalogEntry[];
  byId: Map<string, RepoCatalogEntry>;
  byKey: Map<string, RepoCatalogEntry>;
  apps: RepoAppSummary[];
  /** Stale override keys or props, and other catalog-level problems. */
  warnings: string[];
}

export interface RepoComponentsOptions {
  folderRoot: string;
  config: () => Config;
  /** Ids already taken by the default provider, helpers and extensions. */
  reservedIds: () => Set<string>;
  /** Modules a framework adapter owns (see `DiscoverOptions.owned`). */
  owned?: ((specifier: string, resolved: string | null) => boolean) | undefined;
}

const OVERRIDES_FILE = "repo-components.json";

export class RepoComponents {
  private cached: Promise<RepoCatalog> | null = null;
  private readFiles = new Set<string>();
  private packageIndexes = new Map<string, { stamp: string; index: DeclarationIndex }>();

  constructor(private readonly opts: RepoComponentsOptions) {}

  catalog(): Promise<RepoCatalog> {
    if (!this.cached) {
      this.cached = this.build().catch((error: unknown) => {
        this.cached = null;
        throw error;
      });
    }
    return this.cached;
  }

  /**
   * Drop the cached catalog when a changed file is one it was built from, or
   * when the change is unattributed (`changed` empty/absent). Returns whether
   * it dropped — callers use that to decide what else to rebuild.
   */
  invalidate(changed?: readonly string[]): boolean {
    if (!this.cached) return false;
    const relevant =
      !changed ||
      changed.length === 0 ||
      changed.some(
        (file) =>
          this.readFiles.has(file) ||
          /(^|[\\/])(package\.json|tsconfig[^\\/]*\.json|repo-components\.json)$/.test(file) ||
          /\.stories\.[jt]sx?$/.test(file) ||
          /[\\/]preview(\.[\w-]+)?\.[jt]sx?$/.test(file),
      );
    if (relevant) this.cached = null;
    return relevant;
  }

  /** Every host app this folder can draw components from. */
  apps(): { app: string | undefined; hostApp: HostApp | undefined; hostRoot: string }[] {
    const config = this.opts.config();
    const out: { app: string | undefined; hostApp: HostApp | undefined; hostRoot: string }[] = [
      {
        app: undefined,
        hostApp: config.hostApp,
        hostRoot: hostAppRootFrom(this.opts.folderRoot, config.hostApp),
      },
    ];
    for (const [app, hostApp] of Object.entries(config.hostApps ?? {})) {
      out.push({ app, hostApp, hostRoot: hostAppRootFrom(this.opts.folderRoot, hostApp) });
    }
    return out;
  }

  host(app: string | undefined): {
    hostRoot: string;
    hostApp: HostApp | undefined;
    aliases: { from: string; to: string }[];
  } {
    const found = this.apps().find((entry) => entry.app === app) ?? this.apps()[0];
    const hostApp = found?.hostApp;
    return {
      hostRoot: found?.hostRoot ?? hostAppRootFrom(this.opts.folderRoot, undefined),
      hostApp,
      aliases: aliasPairs(hostApp),
    };
  }

  recipes(app: string | undefined): FrameworkRecipe[] {
    return recipesForHost(this.host(app).hostRoot);
  }

  preview(app: string | undefined): PreviewEntry {
    const { hostRoot, hostApp } = this.host(app);
    return resolvePreviewEntry({
      folderRoot: this.opts.folderRoot,
      hostRoot,
      hostApp,
      app,
      recipes: this.recipes(app),
    });
  }

  /** Source directories whose edits can change the catalog or a mounted component. */
  watchDirs(): string[] {
    const dirs = new Set<string>();
    for (const { hostRoot, hostApp } of this.apps()) {
      for (const dir of ["src", "app", "pages", "components", "lib"]) {
        if (existsSync(join(hostRoot, dir))) dirs.add(join(hostRoot, dir));
      }
      for (const root of hostApp?.components?.include ?? []) {
        const abs = join(hostRoot, root);
        if (existsSync(abs)) dirs.add(statSync(abs).isDirectory() ? abs : dirname(abs));
      }
    }
    return [...dirs];
  }

  private async build(): Promise<RepoCatalog> {
    const warnings: string[] = [];
    const overrides = this.readOverrides(warnings);
    const drafts: RepoCatalogEntry[] = [];
    const apps: RepoAppSummary[] = [];
    const readFiles = new Set<string>();

    for (const { app, hostApp, hostRoot } of this.apps()) {
      if (!existsSync(hostRoot)) continue;
      const aliases = aliasPairs(hostApp);
      const discovery = await discoverRepoComponents({
        hostRoot,
        aliases,
        app,
        include: hostApp?.components?.include,
        exclude: hostApp?.components?.exclude,
        owned: this.opts.owned,
      });
      for (const file of discovery.files) readFiles.add(file);
      const recipes = recipesForHost(hostRoot);
      const stories = await collectStoryStates(hostRoot);
      const storyStates = new Map(stories.map((entry) => [entry.key, entry.states]));
      const localIndex = emptyIndex();
      const indexed = new Set<string>();
      for (const component of discovery.components) {
        if (component.source === "local" && component.file) {
          indexLocalDeclarations(component.file, localIndex, indexed);
        }
      }
      // Two local modules can both declare `NumberFieldProps`; each component
      // reads its own module's declarations first, the app's others after.
      const fileIndexes = new Map<string, DeclarationIndex>();
      const localIndexFor = (file: string | undefined): DeclarationIndex => {
        if (!file) return localIndex;
        const cached = fileIndexes.get(file);
        if (cached) return cached;
        const own = emptyIndex();
        indexLocalDeclarations(file, own, new Set());
        const merged: DeclarationIndex = {
          props: new Map([...localIndex.props, ...own.props]),
          literalAliases: new Map([...localIndex.literalAliases, ...own.literalAliases]),
          staticMembers: new Map([...localIndex.staticMembers, ...own.staticMembers]),
          variantTables: new Map([...localIndex.variantTables, ...own.variantTables]),
        };
        fileIndexes.set(file, merged);
        return merged;
      };
      const known = new Set(discovery.components.map((c) => keyOf(c.identity)));
      for (const component of discovery.components) {
        const index =
          component.source === "package" && component.packageName
            ? this.packageIndex(component.packageName, hostRoot)
            : localIndexFor(component.file);
        const recipe = recipeForSpecifier(component.identity.importPath);
        const activeRecipe = recipe && recipes.includes(recipe) ? recipe : undefined;
        drafts.push(entryFor(component, index, storyStates, activeRecipe));
        // Parts of a used compound family are placeable even when this app
        // happens not to render every one of them.
        if (!component.identity.member) {
          const parts = index.staticMembers.get(component.identity.exportName) ?? [];
          for (const part of parts) {
            const identity = { ...component.identity, member: part };
            if (known.has(keyOf(identity))) continue;
            known.add(keyOf(identity));
            const partComponent: DiscoveredComponent = {
              ...component,
              name: `${component.name}.${part}`,
              identity,
              usages: [],
            };
            drafts.push({
              ...entryFor(partComponent, index, storyStates, activeRecipe),
              viaFamily: true,
            });
          }
        }
      }
      for (const draft of drafts) {
        if (draft.identity.member) continue;
        const parts = drafts
          .filter(
            (other) =>
              other.identity.member &&
              other.identity.importPath === draft.identity.importPath &&
              other.identity.exportName === draft.identity.exportName &&
              other.identity.app === draft.identity.app,
          )
          .map((other) => other.identity.member as string);
        if (parts.length > 0) draft.parts = parts;
      }
      const preview = resolvePreviewEntry({
        folderRoot: this.opts.folderRoot,
        hostRoot,
        hostApp,
        app,
        recipes,
      });
      apps.push({
        ...(app ? { app } : {}),
        hostRoot,
        recipes: recipes.map((recipe) => recipe.id),
        preview: { kind: preview.kind, label: preview.label },
        wrappers: discovery.wrappers,
        globalStyles: discovery.globalStyles,
        entries: discovery.entries,
        skipped: discovery.skipped,
      });
    }

    const entries = applyOverrides(drafts, overrides, warnings);
    assignIds(entries, this.opts.reservedIds());
    entries.sort((a, b) => a.family.localeCompare(b.family) || a.name.localeCompare(b.name));
    this.readFiles = readFiles;
    return {
      entries,
      byId: new Map(entries.map((entry) => [entry.id, entry])),
      byKey: new Map(entries.map((entry) => [entry.key, entry])),
      apps,
      warnings,
    };
  }

  private packageIndex(packageName: string, hostRoot: string): DeclarationIndex {
    let stamp = "";
    try {
      const pkgJson = Bun.resolveSync(`${packageName}/package.json`, hostRoot);
      stamp = `${pkgJson}:${statSync(pkgJson).mtimeMs}`;
    } catch {
      return emptyIndex();
    }
    const cached = this.packageIndexes.get(stamp);
    if (cached) return cached.index;
    const index = indexPackageDeclarations(packageName, hostRoot);
    this.packageIndexes.set(stamp, { stamp, index });
    return index;
  }

  private readOverrides(warnings: string[]): Map<string, RepoComponentOverride> {
    const path = join(this.opts.folderRoot, OVERRIDES_FILE);
    if (!existsSync(path)) return new Map();
    try {
      const parsed = RepoComponentsManifestSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
      if (!parsed.success) {
        warnings.push(
          `${OVERRIDES_FILE} is invalid: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
        );
        return new Map();
      }
      return new Map(Object.entries(parsed.data.components));
    } catch (error) {
      warnings.push(
        `${OVERRIDES_FILE} could not be read: ${error instanceof Error ? error.message : String(error)}`,
      );
      return new Map();
    }
  }
}

/** `importPath#Export[.Member]` — the override-file key (app-independent). */
function keyOf(identity: RepoComponentRef): string {
  return `${identity.importPath}#${identity.exportName}${identity.member ? `.${identity.member}` : ""}`;
}

function entryFor(
  component: DiscoveredComponent,
  index: DeclarationIndex,
  stories: Map<string, PreviewState[]>,
  recipe: FrameworkRecipe | undefined,
): RepoCatalogEntry {
  const family = component.name.split(".")[0] ?? component.name;
  const declared = propsFor(declarationName(component), index) ?? [];
  const byName = new Map(declared.map((prop) => [prop.name, prop]));
  if (!component.identity.member) {
    for (const prop of variantPropsFor(declarationName(component), index)) {
      // A variant table knows the option set a `string`-typed prop can't.
      if (byName.get(prop.name)?.control !== "enum") byName.set(prop.name, prop);
    }
  }
  for (const usage of component.usages) {
    for (const [name, value] of Object.entries(usage.props)) {
      if (byName.has(name)) continue;
      byName.set(name, observedProp(name, value));
    }
    for (const name of usage.expressions) {
      if (byName.has(name)) continue;
      byName.set(name, {
        name,
        type: "unknown",
        optional: true,
        control: "string",
        serializable: false,
        constraint:
          "The app passes code here (a handler, variable or element); set a literal value or leave it to the app.",
      });
    }
  }
  const props = [...byName.values()];
  const states: PreviewState[] = [
    ...(component.identity.member
      ? []
      : (stories.get(
          `${component.source === "local" ? "local" : component.identity.importPath}#${component.identity.exportName === "default" ? family : component.identity.exportName}`,
        ) ?? [])),
    ...component.usages
      .filter((usage) => Object.keys(usage.props).length > 0 || usage.text)
      .map(
        (usage): PreviewState => ({
          name: `As used at ${usage.at}`,
          props: { ...usage.props, ...(usage.text ? { children: usage.text } : {}) },
          source: "usage",
          at: usage.at,
          ...(usage.expressions.length > 0 ? { dropped: usage.expressions } : {}),
        }),
      ),
  ];
  const styleProps = recipe
    ? recipe.styleProps
    : ["className", "style", "sx"].filter((name) => byName.has(name));
  return {
    id: component.name,
    name: component.name,
    identity: component.identity,
    key: repoKey(component.identity),
    source: component.source,
    ...(component.packageName ? { packageName: component.packageName } : {}),
    family,
    group: recipe?.groups?.[family] ?? groupFor(family),
    props,
    acceptsChildren: byName.has("children") || component.usages.some((usage) => usage.hasChildren),
    states,
    provenance: component.usages.map((usage) => usage.at),
    ...(recipe ? { recipe: recipe.id } : {}),
    styleProps,
  };
}

/** The declaration name to look up: `Tabs.List` → `TabsList`, default exports by their local name. */
function declarationName(component: DiscoveredComponent): string {
  const root =
    component.identity.exportName === "default"
      ? component.name.split(".")[0]
      : component.identity.exportName;
  return [root, component.identity.member].filter(Boolean).join(".");
}

function observedProp(name: string, value: unknown): RepoPropDescriptor {
  const control =
    typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string";
  return {
    name,
    type: `${typeof value} (observed)`,
    optional: true,
    control,
    serializable: true,
  };
}

function applyOverrides(
  entries: RepoCatalogEntry[],
  overrides: Map<string, RepoComponentOverride>,
  warnings: string[],
): RepoCatalogEntry[] {
  const byKey = new Map(entries.map((entry) => [keyOf(entry.identity), entry]));
  for (const key of overrides.keys()) {
    if (!byKey.has(key))
      warnings.push(`${OVERRIDES_FILE}: "${key}" matches no discovered component`);
  }
  const out: RepoCatalogEntry[] = [];
  for (const entry of entries) {
    const override = overrides.get(keyOf(entry.identity));
    if (!override) {
      out.push(entry);
      continue;
    }
    if (override.exclude) continue;
    const props = new Map(entry.props.map((prop) => [prop.name, prop]));
    for (const prop of override.props ?? []) {
      props.set(prop.name, { ...props.get(prop.name), ...prop, serializable: true });
    }
    const known = new Set(props.keys());
    const states = Object.entries(override.states ?? {}).map(([name, stateProps]): PreviewState => {
      for (const propName of Object.keys(stateProps)) {
        if (!known.has(propName) && propName !== "children") {
          warnings.push(
            `${OVERRIDES_FILE}: state "${name}" of ${keyOf(entry.identity)} sets unknown prop "${propName}"`,
          );
        }
      }
      return { name, props: stateProps, source: "manifest" };
    });
    out.push({
      ...entry,
      props: [...props.values()],
      states: [...states, ...entry.states],
      ...(override.description ? { description: override.description } : {}),
      ...(override.proxy ? { proxy: override.proxy } : {}),
    });
  }
  return out;
}

/**
 * Give every entry an id an agent can write. A family whose root name is taken
 * — by the provider (`Button`), a helper (`Text`), an extension, or another
 * source's component of the same name — is qualified with its source's
 * namespace (`Mantine.Button`, `App.Button`). The qualification is reported,
 * so the shadowing rule is visible rather than an ordering accident.
 */
function assignIds(entries: RepoCatalogEntry[], reserved: Set<string>): void {
  const sourcesByFamily = new Map<string, Set<string>>();
  for (const entry of entries) {
    const sources = sourcesByFamily.get(entry.family) ?? new Set<string>();
    sources.add(
      `${entry.identity.app ?? ""}:${entry.identity.importPath}#${entry.identity.exportName}`,
    );
    sourcesByFamily.set(entry.family, sources);
  }
  for (const entry of entries) {
    const takenByProvider = reserved.has(entry.family);
    const shared = (sourcesByFamily.get(entry.family)?.size ?? 0) > 1;
    if (!takenByProvider && !shared) continue;
    entry.id = `${namespaceOf(entry)}.${entry.name}`;
    entry.qualifiedBecause = takenByProvider
      ? `"${entry.family}" is also this folder's provider or helper component`
      : `"${entry.family}" is exported by more than one source`;
  }
  // Two sources in the same namespace (two local `NumberField`s) still share an
  // id — and an id is what selection, URLs and compose tags key on. Name them by
  // the shortest tail of their module path that tells them apart.
  const byId = new Map<string, RepoCatalogEntry[]>();
  for (const entry of entries) byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry]);
  for (const group of byId.values()) {
    const sources = new Set(group.map((entry) => entry.identity.importPath));
    if (sources.size < 2) continue;
    const segments = new Map(
      group.map((entry) => [
        entry,
        entry.identity.importPath
          .split("/")
          .filter((part) => part && part !== "." && part !== ".." && part !== "index"),
      ]),
    );
    const longest = Math.max(...[...segments.values()].map((parts) => parts.length));
    for (let depth = 1; depth <= longest; depth++) {
      const tail = (entry: RepoCatalogEntry) =>
        pascal((segments.get(entry) ?? []).slice(-depth).join("-"));
      if (new Set(group.map(tail)).size < sources.size && depth < longest) continue;
      for (const entry of group) {
        entry.id = `${tail(entry)}.${entry.name}`;
        entry.qualifiedBecause = `"${entry.family}" is exported by more than one module (${entry.identity.importPath})`;
      }
      break;
    }
  }
}

/** `@mantine/core` → `Mantine`, `react-bootstrap` → `ReactBootstrap`, local → `App`. */
function namespaceOf(entry: Pick<RepoCatalogEntry, "source" | "packageName" | "identity">): string {
  const app = entry.identity.app ? pascal(entry.identity.app) : "";
  if (entry.source === "local" || !entry.packageName) return app ? `${app}App` : "App";
  const name = entry.packageName.startsWith("@")
    ? (entry.packageName.slice(1).split("/")[0] ?? entry.packageName)
    : entry.packageName;
  return pascal(name);
}

function pascal(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

const GROUP_RULES: [RegExp, ComponentGroup][] = [
  [/^(Icon|Avatar|Image|Logo|Illustration|Svg)/, "visuals"],
  [/(Button|Action|Toggle|Fab)$/, "actions"],
  [
    /(Input|Select|Checkbox|Radio|Switch|Slider|Field|Form|Textarea|Picker|Autocomplete|Combobox|Rating|Chip)/,
    "forms",
  ],
  [/(Alert|Toast|Notification|Progress|Loader|Spinner|Skeleton|Snackbar|Banner)/, "feedback"],
  [/(Nav|Menu|Tabs|Breadcrumb|Pagination|Stepper|Link|Sidebar|Tab$)/, "navigation"],
  [/(Modal|Dialog|Drawer|Popover|Tooltip|HoverCard|Sheet|Overlay)/, "overlays"],
  [
    /(Grid|Stack|Group|Container|Flex|Box|Center|Shell|Layout|Paper|Card|Space|Divider|Section|Row|Col)/,
    "layout",
  ],
  [/^(Text|Title|Heading|Typography|Code|Blockquote|Mark|Highlight|Kbd|Label)$/, "typography"],
];

function groupFor(family: string): ComponentGroup {
  for (const [pattern, group] of GROUP_RULES) if (pattern.test(family)) return group;
  return "display";
}
