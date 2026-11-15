import type { SketchbookStage } from "@velloo/schema";

/** Each sketchbook step as the rail and the Agent tab name it. */
export const SKETCHBOOK_STEP_LABELS: Record<SketchbookStage, string> = {
  brief: "Brief",
  directions: "Directions",
  inspiration: "Inspiration",
  mocks: "Mocks",
  screens: "Screens",
};
