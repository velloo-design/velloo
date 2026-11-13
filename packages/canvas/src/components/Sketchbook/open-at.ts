import type { SketchbookStage } from "@velloo/schema";
import { useCanvas } from "../../store.ts";

/**
 * Open a sketchbook on one direction's card, on the step that shows the image
 * a screen or Look came from: the mood boards unless it was a mock.
 */
export async function openSketchbookAt(
  id: string,
  direction: string | undefined,
  step: SketchbookStage = "boards",
): Promise<void> {
  const { openSketchbook, setSketchbookStep } = useCanvas.getState();
  await openSketchbook(id);
  if (!direction) return;
  setSketchbookStep(step);
  // The step renders after the sketchbook arrives; wait for the direction's card.
  for (let i = 0; i < 20; i++) {
    const card = document.querySelector(`[data-direction="${CSS.escape(direction)}"]`);
    if (card) {
      card.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}
