import { useEffect, useState } from "react";
import { type StartingPoint, theme as themeApi } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "../ui/item.tsx";

/**
 * Design systems to start from. Each card is drawn with what choosing it will
 * set — the system's primary colour, its typeface and its corner radius — so
 * the choice is made on the things it changes, not on a name.
 */
export function StartingPoints() {
  const themeName = useCanvas((s) => s.themeName);
  const [points, setPoints] = useState<StartingPoint[]>([]);
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void themeApi
      .startingPoints()
      .then((next) => {
        if (alive) setPoints(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const apply = (id: string) => {
    setApplied(id);
    void themeApi.applyStartingPoint(themeName, id).catch((err) => {
      setApplied(null);
      toastError(err, "Could not apply the starting point");
    });
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
              aria-pressed={applied === point.id}
              onClick={() => apply(point.id)}
            >
              <ItemMedia>
                <span
                  aria-hidden
                  className="grid size-8 place-items-center text-xs font-medium text-white"
                  style={{
                    background: point.primary,
                    borderRadius: point.radius,
                    fontFamily: point.font,
                  }}
                >
                  Aa
                </span>
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
        Each sets the primary colour, typeface and corner radius that system is known for. The rest
        of the palette, light and dark, is derived from the primary — adjust any of it below.
      </p>
    </div>
  );
}
