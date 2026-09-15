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

const PROJECT_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * The repo-root `velloo.json`. It names a repo's design folders so a monorepo
 * can hold several, and carries the handful of preferences that belong to the
 * repo rather than to any one design folder — feedback consent is answered
 * once per person, not once per canvas.
 *
 * Design settings still live in each folder's `.design/config.json`; nothing
 * here duplicates that contract.
 *
 * Every project is a path to a design folder inside the repository. A design
 * kept outside it is recorded only on the machine that has it, never here.
 */
export const RepoManifestSchema = z
  .object({
    $schema: z.string().optional(),
    projects: z.record(
      z.string().regex(PROJECT_NAME, "project names are letters/digits plus . _ -"),
      z.string().min(1),
    ),
    defaultProject: z.string().optional(),
    feedback: FeedbackPrefsSchema.optional(),
  })
  .refine((m) => !m.defaultProject || m.defaultProject in m.projects, {
    message: "defaultProject must name an entry in projects",
  });

export type RepoManifest = z.infer<typeof RepoManifestSchema>;

/** Filename of the repo-root manifest, resolved by walking up from a folder. */
export const REPO_MANIFEST_FILE = "velloo.json";
