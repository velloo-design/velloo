import { useEffect, useState } from "react";
import { type StartingPoint, theme as themeApi } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../ui/item.tsx";

/**
 * Directions to start from. Each card is drawn with what choosing it sets — a
 * colour, a face, a corner — so the choice is made on those and not on a name.
 *
 * A card is lit only while the theme is still exactly that direction. Which
 * one that is comes from the server on every theme change rather than from
 * what was last clicked: recolour a role or move the corners and the theme is
 * no longer the preset, so nothing is lit.
 */
export function StartingPoints() {
  const themeName = useCanvas((s) => s.themeName);
  const themeVersion = useCanvas((s) => s.themeVersion);
  const [points, setPoints] = useState<StartingPoint[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    void themeVersion;
    let alive = true;
    void themeApi
      .startingPoints(themeName)
      .then((next) => {
        if (!alive) return;
        setPoints(next.startingPoints);
        setActive(next.active);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [themeName, themeVersion]);

  const apply = (id: string) => {
    void themeApi
      .applyStartingPoint(themeName, id)
      .catch((err) => toastError(err, "Could not apply the starting point"));
  };

  if (points.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        {points.map((point) => (
          <Item
            key={point.id}
            asChild
            size="xs"
            variant="outline"
            className="cursor-pointer flex-nowrap text-left hover:bg-muted/50 aria-pressed:border-primary aria-pressed:bg-muted/50"
          >
            <button
              type="button"
              aria-pressed={active === point.id}
              title={point.note}
              onClick={() => apply(point.id)}
            >
              <ItemMedia>
                <span
                  aria-hidden
                  className="block size-8 border border-black/10"
                  style={{ background: point.primary, borderRadius: point.radius }}
                />
              </ItemMedia>
              <ItemContent className="min-w-0 gap-0">
                <ItemTitle className="text-xs">{point.name}</ItemTitle>
                <ItemDescription className="truncate text-[10px]">{point.note}</ItemDescription>
              </ItemContent>
            </button>
          </Item>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        A place to begin, not a framework: each sets a colour, faces and corners, and derives the
        rest of the palette in light and dark. Change anything afterwards.
      </p>
    </div>
  );
}
