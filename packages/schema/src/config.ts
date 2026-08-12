import { z } from "zod";

export const ViewportPresetSchema = z.object({
  name: z.string().min(1),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});

export type ViewportPreset = z.infer<typeof ViewportPresetSchema>;

export const ComponentSourceSchema = z.object({
  framework: z.literal("shadcn-react"),
  snapshotVersion: z.string().min(1),
});

export type ComponentSource = z.infer<typeof ComponentSourceSchema>;

export const CodegenConfigSchema = z.object({
  /** Import prefix for emitted shadcn imports. Defaults to "@/components/ui". */
  componentsAlias: z.string().min(1).optional(),
});

export type CodegenConfig = z.infer<typeof CodegenConfigSchema>;

export const ConfigSchema = z.object({
  schemaVersion: z.literal(1),
  toolVersion: z.string().min(1),
  componentSource: ComponentSourceSchema,
  viewportPresets: z.array(ViewportPresetSchema).min(1),
  codegen: CodegenConfigSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;
