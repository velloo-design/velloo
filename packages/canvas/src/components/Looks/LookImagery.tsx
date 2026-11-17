import type { LookImage } from "@velloo/schema";
import { useLightbox } from "../ImageLightbox.tsx";

const KIND_LABEL: Record<string, string> = {
  moodboard: "Mood board",
  mock: "Mock",
  reference: "Reference",
};

/** A Look's images as thumbnails, each opening at full size. */
export function LookImagery({
  images,
  columns = 3,
}: {
  images: LookImage[];
  /** How many thumbnails a row holds: three in the rail, one in a narrow column. */
  columns?: 1 | 2 | 3;
}) {
  const lightbox = useLightbox(images);
  const grid = columns === 1 ? "grid-cols-1" : columns === 2 ? "grid-cols-2" : "grid-cols-3";
  return (
    <>
      <div className={`grid gap-1.5 ${grid}`} data-look-imagery>
        {images.map((image) => {
          const label = KIND_LABEL[image.kind] ?? image.kind;
          return (
            <button
              key={image.path}
              type="button"
              title={image.note ? `${label}: ${image.note}` : label}
              aria-label={`Open the ${label.toLowerCase()} at full size`}
              onClick={() => lightbox.open(image)}
              className="relative aspect-[3/2] overflow-hidden rounded-md border bg-muted cursor-zoom-in"
            >
              <img
                src={`/${image.path}`}
                alt=""
                loading="lazy"
                className="size-full object-cover object-top"
              />
            </button>
          );
        })}
      </div>
      {lightbox.view}
    </>
  );
}
