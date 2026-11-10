import type { ArtDirectionStage } from "@velloo/schema";

/** Each art direction step as the rail and the Agent tab name it. */
export const ART_DIRECTION_STEP_LABELS: Record<ArtDirectionStage, string> = {
  brief: "Brief",
  directions: "Directions",
  boards: "Mood boards",
  mocks: "Mocks",
  build: "Build",
};
