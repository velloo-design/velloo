import type { ComponentFidelity } from "@velloo/protocol";
import type {
  ComponentDescriptor,
  ComponentProvider,
  FrameworkAdapter,
  Manifest,
} from "@velloo/provider";
import type { CanvasComponentDiagnostic } from "./canvas-bundle.ts";
import type { CanvasBundler } from "./canvas-bundler.ts";

/**
 * Where a folder's non-repository components come from. Read off the manifest
 * rather than the provider id: a descriptor's `source` is `"velloo"` for the
 * helpers and the bare primitives, and the library's own name (`"antd"`,
 * `"shadcn"`) for real library components. An HTML or no-library folder has
 * nothing but `"velloo"` descriptors, which is exactly why it must never be
 * told a real library renders its screens.
 */
type AdapterRenderSource = "bundled-library" | "velloo-primitives";

function adapterRenderSource(manifest: Manifest): AdapterRenderSource {
  return manifest.some((entry) => entry.source !== "velloo")
    ? "bundled-library"
    : "velloo-primitives";
}

/** `null` when it fails to load — which says nothing about how anything renders. */
async function loadLibraryManifest(provider: ComponentProvider): Promise<Manifest | null> {
  try {
    return await provider.loadManifest();
  } catch {
    return null;
  }
}

/** A diagnostic plus whether a mounted frame reported it, rather than only a build. */
export type ObservedDiagnostic = CanvasComponentDiagnostic & { observed: boolean };

/** Verdicts a build alone can reach but only a mounted frame can confirm. */
const BUILD_ONLY: ReadonlySet<ComponentFidelity> = new Set(["exact", "adapted"]);

const BUILD_CAVEAT =
  "Build-checked only: the source compiles and exports it, and no mounted frame has confirmed it renders yet.";

/**
 * Merge what mounted frames reported into the build's verdicts. `observed`
 * marks the ones a frame confirmed; an unconfirmed `exact` or `adapted` says
 * in its note that it is a build check, since the module compiling is not the
 * component rendering.
 */
export function withObservation(
  built: readonly CanvasComponentDiagnostic[],
  runtime: readonly CanvasComponentDiagnostic[],
): ObservedDiagnostic[] {
  const byId = new Map<string, ObservedDiagnostic>(
    built.map((entry) => [entry.id, { ...entry, observed: false }]),
  );
  for (const entry of runtime) {
    const current = byId.get(entry.id);
    if (current) byId.set(entry.id, { ...current, ...entry, observed: true });
  }
  return [...byId.values()].map((entry) =>
    entry.observed || !BUILD_ONLY.has(entry.status)
      ? entry
      : { ...entry, note: entry.note ? `${entry.note} ${BUILD_CAVEAT}` : BUILD_CAVEAT },
  );
}

/**
 * What a component that never reaches the browser mount actually shows. With
 * `inRepoMount`, the answer is about the component anywhere rather than on
 * one screen, so it also says what happens on a screen that does mount: an
 * adapter without a `canvasBundleSpec` has its components drawn from this
 * same server render inside that screen's client mount.
 */
function serverRenderNote(
  provider: FrameworkAdapter,
  descriptor: ComponentDescriptor | undefined,
  inRepoMount: boolean,
): string {
  const base =
    descriptor && descriptor.source !== "velloo"
      ? `Rendered on the server from the real ${provider.label} package that ships with Velloo. It is not client-mounted from the app's own install, so a local patch or a pinned different version of the library is not reflected.`
      : `Rendered on the server from Velloo's own primitives — there is no component library behind it.${
          provider.hostStylesheets
            ? " The design's copies of the app's stylesheets style it, so its fidelity is only as fresh as those copies (store_host_files refreshes them)."
            : ""
        }`;
  return inRepoMount
    ? `${base} On a screen that also uses the app's own components, the canvas draws this same server render inside that screen's client mount, and component_status { screen } lists it there as a fallback.`
    : base;
}

function serverRenderedDiagnostics(
  provider: FrameworkAdapter,
  manifest: Manifest,
  ids: readonly string[],
  inRepoMount: boolean,
): CanvasComponentDiagnostic[] {
  const byId = new Map(manifest.map((entry) => [entry.id, entry]));
  return ids.map((id) => ({
    id,
    status: "server-rendered" as const,
    note: serverRenderNote(provider, byId.get(id), inRepoMount),
  }));
}

const NO_BUNDLER = {
  note: "This adapter builds a browser bundle to render components, and no bundler is available here to build one, so how this component renders has not been established.",
  remedy: "Ask again through the running canvas daemon (velloo run), or pass `screen`.",
};

const NO_MANIFEST = {
  note: "This library's component manifest failed to load, so how this component renders has not been established.",
  remedy: "Check the library's install (velloo upgrade), then ask again.",
};

export function uncheckedForManifest(id: string): ObservedDiagnostic {
  return unchecked(id, NO_MANIFEST);
}

/** A component whose fidelity nothing has established — say so, don't guess one. */
function unchecked(id: string, why: { note: string; remedy: string }): ObservedDiagnostic {
  return { id, status: "unchecked", observed: false, ...why };
}

/**
 * What an answer can say about client mounting without overstating it.
 * `supported` is whether the adapter can client-mount its OWN components —
 * not whether anything on a screen mounts: `CanvasBundler.canMount` mounts
 * any screen that uses repository components whatever the adapter declares.
 * `mounted` is present only on an answer about one screen.
 */
interface HostMount {
  supported: boolean;
  mounted?: boolean;
  note: string;
}

function noMountNote(provider: FrameworkAdapter): string {
  const why = provider.canvasBundleSpec
    ? "This adapter's components render faithfully on the server, so it builds a browser mount only for screens that also use the app's own components"
    : "This adapter has no browser bundle of its own, so its components stay on the server render";
  return `${why}. A screen that uses the app's own components still client-mounts those.`;
}

export interface LibraryStatus {
  /**
   * Only for an adapter with no browser bundle: then the server render IS the
   * answer, and this says whether a real library is behind it. An adapter
   * with a bundle answers per component instead, where a folder-wide
   * "bundled-library" would read as a claim about every one of them.
   */
  renderSource?: AdapterRenderSource;
  renderable?: true;
  hostMount?: HostMount;
  diagnostics: ObservedDiagnostic[];
  /** Asked-about ids the library's manifest doesn't have, for the caller to place. */
  outside: string[];
  /**
   * The manifest failed to load, so `outside` is every asked-about id, not a
   * checked list: an id the caller can't place elsewhere is `unchecked`
   * (`uncheckedForManifest`), never `unknown`.
   */
  unverified?: true;
  /** Absent when no bundle was built — an unbuilt bundle is not an unusable one. */
  usable?: boolean;
  errors: { message: string }[];
}

/**
 * How one library's own components render, asked by id and not about a
 * screen. `null` for a library the folder doesn't have. Three genuinely
 * different answers: the bundle's per-component verdict (merged with what
 * frames observed), rendered on the server because the adapter has no
 * browser bundle, and `unchecked` when nothing here could establish either.
 */
export async function libraryStatus(
  ctx: { providers: Readonly<Record<string, ComponentProvider>> },
  libraryId: string,
  ids: readonly string[],
  bundler: CanvasBundler | undefined,
): Promise<LibraryStatus | null> {
  const provider = ctx.providers[libraryId] as FrameworkAdapter | undefined;
  if (!provider) return null;
  const manifest = await loadLibraryManifest(provider);
  if (!manifest) {
    return {
      diagnostics: [],
      outside: [...ids],
      unverified: true,
      errors: [{ message: `The ${provider.label} component manifest failed to load.` }],
    };
  }
  const known = new Set(manifest.map((entry) => entry.id));
  const recognized = ids.filter((id) => known.has(id));
  const outside = ids.filter((id) => !known.has(id));
  if (!provider.canvasBundleSpec) {
    return {
      renderSource: adapterRenderSource(manifest),
      renderable: true,
      hostMount: { supported: false, note: noMountNote(provider) },
      diagnostics: withObservation(
        serverRenderedDiagnostics(provider, manifest, recognized, true),
        bundler?.runtimeForLibrary(libraryId, recognized) ?? [],
      ),
      outside,
      errors: [],
    };
  }
  if (!bundler) {
    return { diagnostics: recognized.map((id) => unchecked(id, NO_BUNDLER)), outside, errors: [] };
  }
  if (recognized.length === 0) return { diagnostics: [], outside, errors: [] };
  const result = await bundler.build(libraryId, recognized);
  return {
    diagnostics: withObservation(
      result.diagnostics,
      bundler.runtimeForLibrary(libraryId, recognized),
    ),
    usable: result.usable,
    outside,
    errors: result.errors,
  };
}

export interface UnmountedScreenStatus {
  renderSource?: AdapterRenderSource;
  hostMount: HostMount;
  note: string;
  diagnostics: CanvasComponentDiagnostic[];
  errors: { message: string }[];
}

/**
 * A screen nothing on which client-mounts — the adapter has no browser
 * bundle, or declines one for a screen without the app's own components.
 * Either way the server render is the whole render, so each component is
 * reported as that rather than under one blanket claim.
 */
export async function unmountedScreenStatus(
  provider: FrameworkAdapter,
  refs: readonly string[],
): Promise<UnmountedScreenStatus> {
  const hostMount: HostMount = {
    supported: provider.canvasBundleSpec !== undefined,
    mounted: false,
    note: noMountNote(provider),
  };
  const manifest = await loadLibraryManifest(provider);
  if (!manifest) {
    return {
      hostMount,
      note: "This screen is rendered on the server and nothing on it client-mounts. Its library's component manifest failed to load, so what renders each component has not been established.",
      diagnostics: refs.map((id) => unchecked(id, NO_MANIFEST)),
      errors: [{ message: `The ${provider.label} component manifest failed to load.` }],
    };
  }
  const known = new Set(manifest.map((entry) => entry.id));
  const renderSource = adapterRenderSource(manifest);
  return {
    renderSource,
    hostMount,
    note:
      renderSource === "bundled-library"
        ? `This screen is rendered on the server by the real ${provider.label} package that ships with Velloo. That is the whole render — nothing here is client-mounted from the app's own install.`
        : "This screen is rendered on the server from Velloo's own primitives and native markup; there is no component library behind it, so there is nothing to mount from the app.",
    diagnostics: serverRenderedDiagnostics(
      provider,
      manifest,
      refs.filter((id) => known.has(id)),
      false,
    ),
    errors: [],
  };
}
