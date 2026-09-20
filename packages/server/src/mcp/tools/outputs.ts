import { z } from "zod";

/**
 * Declared result shapes for the tools an agent *branches* on — where the
 * response is not "did it work" but data to read. A tool that declares one
 * must also return `structuredContent` (see {@link structuredResult}); the SDK
 * validates it, so every schema here is `looseObject`: an unexpected extra
 * field must never turn a good result into a protocol error.
 *
 * Only these tools carry one. The rest return a small confirmation object that
 * a schema would restate rather than explain, and every declared schema is
 * paid for by every session — so the bar is "the description gets shorter
 * because this exists".
 *
 * `screenshot` is deliberately absent: its result is a five-way union
 * (baseline established / no visual change / cropped diff / full diff / plain
 * capture) whose branches share almost nothing, so a schema permissive enough
 * to accept all five would document none of them.
 */

const FoundNodeSchema = z.looseObject({
  path: z.array(z.number()),
  kind: z.enum(["component", "snippet", "param"]),
  ref: z.string().optional(),
  id: z.string().optional(),
  className: z.string().optional(),
  textPreview: z.string().optional(),
  childCount: z.number(),
});

export const FindNodesOutput = z.looseObject({
  matches: z.array(FoundNodeSchema),
  /** Matches before `limit` was applied. */
  total: z.number(),
});

export const ListComponentsOutput = z.looseObject({
  /** Version of the component set these descriptors came from. */
  snapshotVersion: z.string(),
  components: z.array(
    z.looseObject({
      id: z.string(),
      kind: z.enum(["library", "extension", "snippet", "repo"]),
      /** Renderer availability; false is an adapter packaging error. */
      availableInDesign: z.boolean(),
      /** Host-app status only. Missing dependencies are returned by emit_code. */
      installedInApp: z.boolean(),
      /** Present for snippet tags: the persisted kebab-case definition id. */
      snippetId: z.string().optional(),
      /** Present and true on a snippet no screen reaches, directly or via another snippet. */
      unused: z.boolean().optional(),
      /** Present on extensions: where the real component lives in the host app. */
      importPath: z.string().optional(),
    }),
  ),
});

const EmitSnippetIrSchema = z.looseObject({
  id: z.string(),
  /** PascalCase name to use when materializing this as a component. */
  componentName: z.string(),
  params: z.array(
    z.looseObject({
      name: z.string(),
      type: z.string(),
      default: z.string().optional(),
      optional: z.boolean().optional(),
    }),
  ),
  jsx: z.string(),
  componentsToInstall: z.array(z.string()),
  helpersToMaterialize: z.array(z.string()),
  warnings: z.array(z.string()),
  repoImports: z
    .array(
      z.looseObject({
        from: z.string(),
        named: z.array(z.string()).optional(),
        default: z.string().optional(),
      }),
    )
    .optional(),
});

export const EmitCodeOutput = z.looseObject({
  screen: z.looseObject({ id: z.string(), name: z.string() }),
  /** Body only — no imports, no function wrapper. */
  jsx: z.string(),
  /** Library component identifiers to import. */
  componentsUsed: z.array(z.string()),
  /** Bare JSX names to import from lucide-react. */
  iconsUsed: z.array(z.string()),
  /** Each referenced snippet's own IR: materialize it or inline the subtree. */
  snippetsUsed: z.array(EmitSnippetIrSchema),
  classesUsed: z.array(z.string()),
  /** Kebab names ready for `npx shadcn@latest add`. */
  componentsToInstall: z.array(z.string()),
  /** Velloo helpers carrying runtime logic that you must author in the app. */
  helpersToMaterialize: z.array(z.string()),
  /** Non-fatal caveats — things JSX couldn't express faithfully. */
  warnings: z.array(z.string()),
  /** Only on a Tailwind v3 host: classes to rename while writing the file. */
  tailwindV3Compat: z.array(z.unknown()).optional(),
});

export const CompareToUrlOutput = z.looseObject({
  /** 1 = identical. 0.85+ is a faithful structural port. */
  similarity: z.number(),
  changedRatio: z.number(),
  /** Similarity over the overlapping height only; present when heights differ. */
  contentSimilarity: z.number().optional(),
  /** Velloo render height minus capture height, normalized to CSS px. */
  heightDelta: z.number(),
  /** Raw Velloo-minus-capture height in bitmap pixels. */
  bitmapHeightDelta: z.number().optional(),
  /** Velloo render's full content height in CSS px, frame-independent. */
  contentHeight: z.number(),
  /** The worst regions, ranked, each naming the node responsible. Fix in order. */
  topMismatches: z.array(z.string()).optional(),
  /**
   * Per-node computed-style differences behind the worst regions: what the
   * live page resolved versus what the design resolved. Present when both
   * sides could be measured in a browser.
   */
  styleDiff: z.array(z.unknown()).optional(),
  regions: z.array(z.unknown()),
  /** Board frames too short for this screen — resize with update_frame. */
  framesShorterThanContent: z.array(z.unknown()).optional(),
  note: z.string().optional(),
  capture: z.looseObject({}).optional(),
  urlCache: z.looseObject({}).optional(),
  /** True ⇒ the capture is not your page. `similarity` means nothing; fix the capture. */
  unverified: z.literal(true).optional(),
  redirected: z.looseObject({}).optional(),
  authWall: z.literal(true).optional(),
  pageError: z.string().optional(),
  warning: z.string().optional(),
});
