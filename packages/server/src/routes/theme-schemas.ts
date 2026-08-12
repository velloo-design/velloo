import { z } from "zod";

export const SetTokenBody = z.object({
  path: z.string().min(1),
  value: z.union([z.string(), z.number()]),
});

export const ApplyPresetBody = z.object({
  presetName: z.string().min(1),
});

export const DeriveFromColorBody = z.object({
  seedColor: z.string().min(1),
  name: z.string().min(1).optional(),
});

export const MatchVibeBody = z.object({
  description: z.string().min(1),
  useAi: z.boolean().optional(),
});

export const MatchImageBody = z.object({
  imagePath: z.string().min(1),
});
