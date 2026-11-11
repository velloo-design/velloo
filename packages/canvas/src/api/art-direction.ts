import type {
  ArtDirectionGenerateResult,
  ArtDirectionState,
  GenerateArtDirectionBody,
  ImageModels,
  UpdateArtDirectionBody,
} from "@velloo/protocol";
import type { ArtDirectionFile } from "@velloo/schema";
import { getJson } from "./discovery.ts";
import { postJson } from "./http.ts";

export const artDirection = {
  fetch(): Promise<ArtDirectionState> {
    return getJson("/api/art-direction", "art-direction");
  },
  /** The image models with live prices; `models` is null while signed out. */
  models(): Promise<{ models: ImageModels | null; signedOut?: boolean; problem?: string }> {
    return getJson("/api/art-direction/models", "image models");
  },
  update(body: UpdateArtDirectionBody): Promise<ArtDirectionFile> {
    return postJson("/api/art-direction/update", body);
  },
  generate(body: GenerateArtDirectionBody): Promise<ArtDirectionGenerateResult> {
    return postJson("/api/art-direction/generate", body);
  },
  reset(): Promise<{ reset: true }> {
    return postJson("/api/art-direction/reset", {});
  },
  removeImage(path: string): Promise<ArtDirectionFile> {
    return postJson("/api/art-direction/remove-image", { path });
  },
};
