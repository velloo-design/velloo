import type { SketchbookStage } from "@velloo/schema";

/** Each sketchbook step as the rail and the Agent tab name it. */
export const SKETCHBOOK_STEP_LABELS: Record<SketchbookStage, string> = {
  brief: "Brief",
  directions: "Directions",
  boards: "Mood boards",
  mocks: "Mocks",
  screens: "Screens",
  tokens: "Tokens",
};
