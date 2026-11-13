import type {
  BuildSketchbookBody,
  GenerateSketchbookBody,
  ImageModels,
  IntentPrice,
  SketchbookGenerateResult,
  SketchbookLinks,
  SketchbookList,
  SketchbookPages,
  SketchbookState,
  UpdateSketchbookBody,
} from "@velloo/protocol";
import type { SketchbookFile } from "@velloo/schema";
import { getJson } from "./discovery.ts";
import { postJson } from "./http.ts";

export const sketchbook = {
  /** Every sketchbook, the most recently changed first. */
  list(): Promise<SketchbookList> {
    return getJson("/api/sketchbook", "sketchbooks");
  },
  fetch(id: string): Promise<SketchbookState> {
    return getJson(`/api/sketchbook/state?id=${encodeURIComponent(id)}`, "sketchbook");
  },
  create(body: Pick<UpdateSketchbookBody, "origin" | "page" | "name">): Promise<SketchbookState> {
    return postJson("/api/sketchbook/create", body);
  },
  /** What each screen and board came from. */
  links(): Promise<SketchbookLinks> {
    return getJson("/api/sketchbook/links", "sketchbook links");
  },
  /** The app's routes, captured pages and canvas screens, to pick the page to redesign. */
  pages(): Promise<SketchbookPages> {
    return getJson("/api/sketchbook/pages", "pages");
  },
  /** The image models with live prices, and the kinds the cloud draws; `models` is null while signed out. */
  models(): Promise<{
    models: ImageModels | null;
    kinds?: IntentPrice[];
    signedOut?: boolean;
    problem?: string;
  }> {
    return getJson("/api/sketchbook/models", "image models");
  },
  update(id: string, body: UpdateSketchbookBody): Promise<SketchbookFile> {
    return postJson("/api/sketchbook/update", { id, ...body });
  },
  generate(id: string, body: GenerateSketchbookBody): Promise<SketchbookGenerateResult> {
    return postJson("/api/sketchbook/generate", { id, ...body });
  },
  build(id: string, body: BuildSketchbookBody): Promise<{ boardId: string }> {
    return postJson("/api/sketchbook/build", { id, ...body });
  },
  remove(id: string): Promise<{ deleted: true }> {
    return postJson("/api/sketchbook/delete", { id });
  },
  removeImage(id: string, path: string): Promise<SketchbookFile> {
    return postJson("/api/sketchbook/remove-image", { id, path });
  },
};
