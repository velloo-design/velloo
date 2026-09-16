import { z } from "zod";

/**
 * Consent for the `send_feedback` tool.
 *
 * `enabled` is a repo decision (committed in `velloo.json`) — whether the tool
 * exists for this project at all. `contactOk` records consent to be *contacted*
 * about what was sent, which is personal: it is read from and written to the
 * machine's `~/.velloo/prefs.json`, never committed, so cloning a repo can't
 * opt a different person into being emailed. It stays in this shape because
 * every reader wants the pair, and because folders written before the split
 * still carry it on disk (where it is now ignored).
 */
export const FeedbackPrefsSchema = z.object({
  enabled: z.boolean(),
  contactOk: z.boolean().optional(),
});

export type FeedbackPrefs = z.infer<typeof FeedbackPrefsSchema>;

const MAX_DESIGN_NAME = 80;

/**
 * Why `name` can't name a design, or null when it can. Almost anything goes —
 * spaces, emoji, any script. The limits are the ones a name typed as a command
 * argument needs: no path separator (a bare argument with one is read as a
 * path), no control characters, nothing that is only whitespace or a dot
 * path, and no padding a shell would silently strip.
 */
export function designNameIssue(name: string): string | null {
  if (name.trim() === "") return "a design name can't be empty";
  if (name !== name.trim()) return "a design name can't start or end with spaces";
  if (name === "." || name === "..") return `"${name}" can't be a design name`;
  if (/[/\\]/.test(name)) return "a design name can't contain / or \\";
  if (/\p{Cc}/u.test(name)) return "a design name can't contain control characters";
  if ([...name].length > MAX_DESIGN_NAME)
    return `a design name can't be longer than ${MAX_DESIGN_NAME} characters`;
  return null;
}

export function isDesignName(name: string): boolean {
  return designNameIssue(name) === null;
}

/** A Zod string that must be a design name, with the specific reason when it isn't. */
export const DesignNameSchema = z.string().superRefine((name, ctx) => {
  const issue = designNameIssue(name);
  if (issue) ctx.addIssue({ code: "custom", message: issue });
});

/**
 * Coerce free text (a directory name, an app name) into a valid design name,
 * or null when nothing usable is left.
 */
export function toDesignName(text: string): string | null {
  const cleaned = [...text.replace(/[/\\\p{Cc}]+/gu, " ").trim()]
    .slice(0, MAX_DESIGN_NAME)
    .join("")
    .trim();
  return cleaned && isDesignName(cleaned) ? cleaned : null;
}

/**
 * The repo-root `velloo.json`. It lists a repo's designs so a monorepo can
 * hold several, and carries the handful of preferences that belong to the
 * repo rather than to any one design — feedback consent is answered once per
 * person, not once per canvas.
 *
 * Only locations live here: each design's name and settings are in its own
 * `.design/config.json`, so nothing here can drift from the design itself.
 * Every entry is a path to a design folder inside the repository. A design
 * kept outside it is recorded only on the machine that has it, never here.
 */
export const RepoManifestSchema = z
  .object({
    $schema: z.string().optional(),
    designs: z.array(z.string().min(1)),
    /** The name of the design a bare command resolves to when nothing else picks one. */
    defaultDesign: DesignNameSchema.optional(),
    feedback: FeedbackPrefsSchema.optional(),
  })
  .refine((m) => new Set(m.designs).size === m.designs.length, {
    message: "designs lists the same path twice",
  });

export type RepoManifest = z.infer<typeof RepoManifestSchema>;

/** Filename of the repo-root manifest, resolved by walking up from a folder. */
export const REPO_MANIFEST_FILE = "velloo.json";

export interface NormalizedRepoManifest {
  /** The manifest in the current shape, ready for {@link RepoManifestSchema}. */
  manifest: unknown;
  /**
   * Names the pre-v4 `projects` map gave each path. A folder not yet migrated
   * has no `name` in its config, so these stand in until `velloo upgrade`
   * writes them there.
   */
  legacyNames: Record<string, string>;
  /** True when the file was in the pre-v4 shape and should be rewritten. */
  legacy: boolean;
}

/**
 * Read either manifest shape. Before designs carried their own names the file
 * was `{ projects: { name: path }, defaultProject }`; the schema would silently
 * drop those keys, so they are converted here, before parsing.
 */
export function normalizeRepoManifest(raw: unknown): NormalizedRepoManifest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { manifest: raw, legacyNames: {}, legacy: false };
  }
  const { projects, defaultProject, ...rest } = raw as Record<string, unknown>;
  if (projects === undefined || "designs" in rest) {
    return { manifest: raw, legacyNames: {}, legacy: false };
  }
  const legacyNames: Record<string, string> = {};
  const designs: unknown[] = [];
  if (typeof projects === "object" && projects !== null && !Array.isArray(projects)) {
    for (const [name, path] of Object.entries(projects)) {
      designs.push(path);
      if (typeof path === "string") legacyNames[path] = name;
    }
  }
  return {
    manifest: {
      ...rest,
      designs,
      ...(defaultProject !== undefined ? { defaultDesign: defaultProject } : {}),
    },
    legacyNames,
    legacy: true,
  };
}
