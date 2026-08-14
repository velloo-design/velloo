import { z } from "zod";

export const ViewportPresetSchema = z.object({
  name: z.string().min(1),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

export type ViewportPreset = z.infer<typeof ViewportPresetSchema>;

/**
 * Library declaration. Default mode: the design folder owns its copy of the
 * library (pulled at `velloo init` into `<componentsPath>`). Experimental
 * shared mode points at the user's app components folder.
 */
export const LibrarySchema = z.object({
  id: z.literal("shadcn-react"),
  version: z.string().min(1),
  /** "registry:shadcn" (default) or "shared:<path>" (experimental). */
  source: z.string().min(1),
  /** Where the components live, relative to the design folder root. */
  componentsPath: z.string().min(1),
  /** Set when the source is experimental. */
  experimental: z.enum(["shared"]).optional(),
});

export type Library = z.infer<typeof LibrarySchema>;

export const CodegenConfigSchema = z.object({
  /** Import prefix for emitted shadcn imports. Defaults to "@/components/ui". */
  componentsAlias: z.string().min(1).optional(),
});

export type CodegenConfig = z.infer<typeof CodegenConfigSchema>;

export const ConfigSchema = z.object({
  schemaVersion: z.literal(1),
  toolVersion: z.string().min(1),
  library: LibrarySchema,
  viewportPresets: z.array(ViewportPresetSchema).min(1),
  /** Screen id the canvas should focus on first load. Falls back to the first screen. */
  defaultScreen: z.string().min(1).optional(),
  /** Board id the canvas should open on first load. Falls back to the first board. */
  defaultBoard: z.string().min(1).optional(),
  codegen: CodegenConfigSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
