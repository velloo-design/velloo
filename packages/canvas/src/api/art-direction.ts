import type {
  ArtDirectionGenerateResult,
  ArtDirectionList,
  ArtDirectionPages,
  ArtDirectionState,
  BuildArtDirectionBody,
  GenerateArtDirectionBody,
  ImageModels,
  UpdateArtDirectionBody,
} from "@velloo/protocol";
import type { ArtDirectionFile } from "@velloo/schema";
import { getJson } from "./discovery.ts";
import { postJson } from "./http.ts";

export const artDirection = {
  /** Every art direction, the most recently changed first. */
  list(): Promise<ArtDirectionList> {
    return getJson("/api/art-direction", "art directions");
  },
  fetch(id: string): Promise<ArtDirectionState> {
    return getJson(`/api/art-direction/state?id=${encodeURIComponent(id)}`, "art direction");
  },
  create(
    body: Pick<UpdateArtDirectionBody, "origin" | "page" | "name">,
  ): Promise<ArtDirectionState> {
    return postJson("/api/art-direction/create", body);
  },
  /** The app's routes, captured pages and canvas screens, to pick the page to redesign. */
  pages(): Promise<ArtDirectionPages> {
    return getJson("/api/art-direction/pages", "pages");
  },
  /** The image models with live prices; `models` is null while signed out. */
  models(): Promise<{ models: ImageModels | null; signedOut?: boolean; problem?: string }> {
    return getJson("/api/art-direction/models", "image models");
  },
  update(id: string, body: UpdateArtDirectionBody): Promise<ArtDirectionFile> {
    return postJson("/api/art-direction/update", { id, ...body });
  },
  generate(id: string, body: GenerateArtDirectionBody): Promise<ArtDirectionGenerateResult> {
    return postJson("/api/art-direction/generate", { id, ...body });
  },
  build(id: string, body: BuildArtDirectionBody): Promise<{ boardId: string }> {
    return postJson("/api/art-direction/build", { id, ...body });
  },
  remove(id: string): Promise<{ deleted: true }> {
    return postJson("/api/art-direction/delete", { id });
  },
  removeImage(id: string, path: string): Promise<ArtDirectionFile> {
    return postJson("/api/art-direction/remove-image", { id, path });
  },
};
