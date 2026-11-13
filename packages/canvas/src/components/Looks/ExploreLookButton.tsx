import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import { Spinner } from "../ui/spinner.tsx";

/**
 * Start a sketchbook whose subject is a Look rather than a page: directions
 * drawn as palettes and type, tokens proposed from them, one kept as a Look.
 */
export function ExploreLookButton({ className }: { className?: string }) {
  const explore = useCanvas((s) => s.exploreLook);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outline"
      size="xs"
      className={className}
      disabled={busy}
      data-explore-look
      onClick={() => {
        setBusy(true);
        void explore()
          .catch((err) => toastError(err, "Could not start a sketchbook"))
          .finally(() => setBusy(false));
      }}
    >
      {busy ? <Spinner /> : <Sparkles />}
      Explore palettes &amp; type
    </Button>
  );
}
