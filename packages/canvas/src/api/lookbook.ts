import type {
  GenerateLookbookBody,
  ImageModels,
  LookbookGenerateResult,
  LookbookRequestBody,
  LookbookState,
  UpdateLookbookBody,
} from "@velloo/protocol";
import type { LookbookFile } from "@velloo/schema";
import { getJson } from "./discovery.ts";
import { postJson } from "./http.ts";

export const lookbook = {
  fetch(): Promise<LookbookState> {
    return getJson("/api/lookbook", "lookbook");
  },
  /** The image models with live prices; `models` is null while signed out. */
  models(): Promise<{ models: ImageModels | null; signedOut?: boolean; problem?: string }> {
    return getJson("/api/lookbook/models", "image models");
  },
  update(body: UpdateLookbookBody): Promise<LookbookFile> {
    return postJson("/api/lookbook/update", body);
  },
  generate(body: GenerateLookbookBody): Promise<LookbookGenerateResult> {
    return postJson("/api/lookbook/generate", body);
  },
  request(body: LookbookRequestBody): Promise<LookbookFile> {
    return postJson("/api/lookbook/request", body);
  },
  removeImage(path: string): Promise<LookbookFile> {
    return postJson("/api/lookbook/remove-image", { path });
  },
};
