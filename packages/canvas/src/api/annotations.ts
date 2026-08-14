import type { AnnotationEntry } from "../store.ts";
import { postJson } from "./http.ts";

export const annotations = {
  add(args: {
    screenId: string;
    target: { locator: number[] | string };
    body: string;
    position?: { x: number; y: number } | "auto";
    collapsed?: boolean;
  }) {
    return postJson<{ annotation: AnnotationEntry }>("/api/annotations/add", args);
  },
  update(args: {
    screenId: string;
    annotationId: string;
    patch: {
      body?: string;
      position?: { x: number; y: number } | "auto";
      collapsed?: boolean | null;
    };
  }) {
    return postJson<{ annotation: AnnotationEntry }>("/api/annotations/update", args);
  },
  remove(args: { screenId: string; annotationId: string }) {
    return postJson<{ removedId: string }>("/api/annotations/remove", args);
  },
};
