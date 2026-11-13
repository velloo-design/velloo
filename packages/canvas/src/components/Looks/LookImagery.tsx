import type { LookImage } from "@velloo/schema";
import { useLightbox } from "../ImageLightbox.tsx";
import { PlaceComments } from "../PlaceComments.tsx";

const KIND_LABEL: Record<string, string> = {
  moodboard: "Mood board",
  mock: "Mock",
  reference: "Reference",
};

/** A Look's images as thumbnails, each opening at full size. */
export function LookImagery({
  images,
  columns = 3,
  look,
}: {
  images: LookImage[];
  /** The Look they are on, to comment on each; absent shows them without comments. */
  look?: string;
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
            <div key={image.path} className="relative">
              <button
                type="button"
                title={image.note ? `${label}: ${image.note}` : label}
                aria-label={`Open the ${label.toLowerCase()} at full size`}
                onClick={() => lightbox.open(image)}
                className="relative block aspect-[3/2] w-full overflow-hidden rounded-md border bg-muted cursor-zoom-in"
              >
                <img
                  src={`/${image.path}`}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover object-top"
                />
              </button>
              {look !== undefined ? (
                <PlaceComments
                  place={{ kind: "look", look, image: image.path }}
                  label="this image"
                  className="absolute right-1 top-1 h-5 px-1 [&_svg]:size-3"
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {lightbox.view}
    </>
  );
}
