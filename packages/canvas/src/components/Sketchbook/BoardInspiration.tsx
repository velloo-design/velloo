import type { BoardInspiration as Inspiration } from "@velloo/protocol";
import { ChevronDown } from "lucide-react";
import { useEffect } from "react";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.tsx";
import { openSketchbookAt } from "./open-at.ts";
import { SketchbookMark } from "./SketchbookMark.tsx";

function Thumbs({ images }: { images: string[] }) {
  return (
    <span className="flex -space-x-1.5">
      {images.slice(0, 3).map((path) => (
        <img
          key={path}
          src={`/${path}`}
          alt=""
          loading="lazy"
          className="size-5 rounded-sm object-cover ring-2 ring-background"
        />
      ))}
    </span>
  );
}

const open = (entry: Inspiration) =>
  void openSketchbookAt(entry.sketchbook, entry.direction, entry.step).catch((err) =>
    toastError(err, "Could not open the sketchbook"),
  );

/**
 * "Inspired by ‹sketchbook›" over a board whose screens, Look or build came
 * from a sketchbook: the way back to the images, opened at the direction.
 */
export function BoardInspiration({ boardId }: { boardId: string }) {
  const links = useCanvas((s) => s.sketchbookLinks);
  useEffect(() => {
    if (links === null) {
      void useCanvas
        .getState()
        .loadSketchbookLinks()
        .catch(() => {});
    }
  }, [links]);
  const entries = links?.boards[boardId] ?? [];
  const [first] = entries;
  if (!first) return null;
  const chip = (
    <>
      <SketchbookMark className="size-4" />
      <span className="max-w-56 truncate">
        Inspired by {entries.length === 1 ? `“${first.name}”` : `${entries.length} sketchbooks`}
      </span>
      <Thumbs images={entries.flatMap((e) => e.images)} />
    </>
  );
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-10" data-board-inspiration>
      {entries.length === 1 ? (
        <Button
          variant="outline"
          size="sm"
          className="pointer-events-auto shadow-xs"
          onClick={() => open(first)}
        >
          {chip}
        </Button>
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="pointer-events-auto shadow-xs">
              {chip}
              <ChevronDown />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-1">
            <ItemGroup>
              {entries.map((e) => (
                <Item key={e.sketchbook} asChild size="sm">
                  <button
                    type="button"
                    className="w-full text-left hover:bg-muted"
                    onClick={() => open(e)}
                  >
                    <ItemMedia>
                      <Thumbs images={e.images} />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{e.name}</ItemTitle>
                      {e.direction ? <ItemDescription>{e.direction}</ItemDescription> : null}
                    </ItemContent>
                  </button>
                </Item>
              ))}
            </ItemGroup>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
