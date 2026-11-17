import { useCanvas } from "../../store.ts";
import { Loading } from "../Loading.tsx";
import { BriefStep } from "./BriefStep.tsx";
import { DirectionsStep } from "./DirectionsStep.tsx";
import { InspirationStep } from "./InspirationStep.tsx";
import { MocksStep } from "./MocksStep.tsx";
import { ScreensStep } from "./ScreensStep.tsx";
import { SketchbookHome } from "./SketchbookHome.tsx";
import { useSketchbookStep } from "./SketchbookRail.tsx";
import { StartPage } from "./StartPage.tsx";

/** The main area while the sketchbook is open: the step the rail has selected. */
export function SketchbookView() {
  const id = useCanvas((s) => s.sketchbookId);
  const start = useCanvas((s) => s.sketchbookStart);
  const state = useCanvas((s) => s.sketchbook);
  const step = useSketchbookStep();
  if (!id) return start ? <StartPage subject={start} /> : <SketchbookHome />;
  if (!state || state.id !== id) {
    return (
      <div className="flex-1 grid place-items-center">
        <Loading size={36} />
      </div>
    );
  }
  switch (step) {
    case "brief":
      return <BriefStep />;
    case "directions":
      return <DirectionsStep />;
    case "inspiration":
      return <InspirationStep />;
    case "mocks":
      return <MocksStep />;
    case "screens":
      return <ScreensStep />;
  }
}
