import type { FolderConfig } from "../../api.ts";

/**
 * How the settings dialog reports the libraries a folder targets. The rules
 * here exist because a library's config entry says more than it looks like it
 * says: the pinned version means different things per source, and the styling
 * a screen gets is the provider's channel rather than the folder's CSS axis.
 */

export type LibraryEntry = FolderConfig["libraries"][number];

type LibraryFacts = Pick<FolderConfig, "libraries" | "defaultLibrary">;

/** Display names for the provider ids a library entry can name. */
const PROVIDER_NAMES: Record<string, string> = {
  "shadcn-upstream": "shadcn",
  mui: "Material UI",
  antd: "Ant Design",
  chakra: "Chakra UI",
  none: "No library",
};

export function providerName(providerId: string): string {
  return PROVIDER_NAMES[providerId] ?? providerId;
}

/** Vendored snapshots are dated (`2026.05.22`); real packages are semver. */
export function versionText(version: string): string {
  return /^\d{4}\./.test(version) ? `snapshot ${version}` : `v${version}`;
}

/**
 * Where a library's components come from — the half of "which version am I
 * designing against" that the version string alone can't answer.
 */
export function sourceBadge(source: string, version: string): { text: string; title?: string } {
  switch (source) {
    case "in-repo":
      return {
        text: "your repo",
        title: `Components render from your app. Velloo's bundled snapshot (${version}) covers only the files it can't compile.`,
      };
    case "binary":
      return { text: "bundled", title: "Components ship inside the velloo binary." };
    case "cache":
      return { text: "cached", title: "Components were downloaded into ~/.velloo." };
    default:
      return { text: source };
  }
}

/**
 * An `in-repo` library renders your app's own files, so its pinned version
 * describes velloo's fallback snapshot rather than anything on the canvas —
 * it belongs in the source tooltip, not on the line.
 */
export function showsVersion(lib: LibraryEntry): boolean {
  return lib.source !== "in-repo";
}

/**
 * Whether to show the folder-local id — the name a screen puts in `library`.
 * A non-default library has to be named to be reached, so it always shows.
 * The default one is reached by omitting `library` entirely, so its key earns
 * a place only when it isn't already implied by the rest of the line.
 */
export function showsId(lib: LibraryEntry, isDefault: boolean): boolean {
  if (!isDefault) return true;
  const id = lib.id.toLowerCase();
  return (
    id !== "default" &&
    id !== lib.providerId.toLowerCase() &&
    id !== providerName(lib.providerId).toLowerCase()
  );
}

/** Registered libraries, the default first. */
export function orderedLibraries(cfg: LibraryFacts): LibraryEntry[] {
  return [...cfg.libraries].sort(
    (a, b) => Number(b.id === cfg.defaultLibrary) - Number(a.id === cfg.defaultLibrary),
  );
}

/**
 * Whether the folder's libraries disagree about the style channel. They can:
 * the channel is the provider's, so a shadcn + MUI folder writes Tailwind
 * classes on one screen and `sx` on another.
 */
export function hasMixedStyling(libs: LibraryEntry[]): boolean {
  return new Set(libs.map((l) => l.styleLabel)).size > 1;
}

/**
 * The style channel the default library actually writes. Only the no-library
 * provider has a folder-level CSS choice — everywhere else the channel is the
 * provider's own (`sx` for MUI, inline `style` for antd), so this reads the
 * resolved label and falls back to the CSS axis only for a daemon too old to
 * send one.
 */
export function stylingText(cfg: LibraryFacts & Pick<FolderConfig, "styling">): string {
  const resolved = cfg.libraries.find((l) => l.id === cfg.defaultLibrary)?.styleLabel;
  return resolved ?? (cfg.styling === "none" ? "Inline styles" : "Tailwind classes");
}
