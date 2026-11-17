import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";

/** Anything shown by its folder-relative asset path: a sketchbook image, a Look's. */
interface Pictured {
  path: string;
}

/**
 * One image at full size; the arrow keys step through the others it was
 * opened among (every mood board on a step, every image of a Look).
 */
function Lightbox({
  images,
  index,
  onIndex,
}: {
  images: Pictured[];
  index: number | null;
  onIndex: (index: number | null) => void;
}) {
  const image = index === null ? undefined : images[index];
  useEffect(() => {
    if (index === null) return;
    const step = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onIndex(Math.min(images.length - 1, index + 1));
      if (e.key === "ArrowLeft") onIndex(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", step);
    return () => window.removeEventListener("keydown", step);
  }, [index, images.length, onIndex]);
  return (
    <Dialog open={image !== undefined} onOpenChange={(o) => (o ? null : onIndex(null))}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto p-2">
        <DialogHeader className="sr-only">
          <DialogTitle>Full size</DialogTitle>
          <DialogDescription>
            The image at full size. The left and right arrow keys show the others.
          </DialogDescription>
        </DialogHeader>
        {image ? <img src={`/${image.path}`} alt="" className="w-full rounded" /> : null}
        {images.length > 1 && index !== null ? (
          <p className="pb-1 text-center text-xs text-muted-foreground tabular-nums">
            {index + 1} of {images.length} · ← → for the others
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/** The images a view opens at full size, and which one is open. */
export function useLightbox(images: Pictured[]) {
  const [index, setIndex] = useState<number | null>(null);
  return {
    open: (image: Pictured) => setIndex(images.findIndex((i) => i.path === image.path)),
    view: <Lightbox images={images} index={index} onIndex={setIndex} />,
  };
}
