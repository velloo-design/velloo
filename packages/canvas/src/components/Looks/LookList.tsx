import type { LookSummary } from "@velloo/protocol";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { mutate } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { NewThemeDialog } from "../NewThemeDialog.tsx";
import { themeLabel } from "../theme-label.ts";
import { Button } from "../ui/button.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";
import { ExploreLookButton } from "./ExploreLookButton.tsx";

/** A Look's face: its first image, else its colours. */
export function LookCover({ look }: { look: LookSummary }) {
  const cover = look.look?.images[0];
  if (cover) return <img src={`/${cover.path}`} alt="" loading="lazy" />;
  return (
    <span className="flex size-full" aria-hidden>
      {look.swatch.map((colour, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a swatch's stripes are positional
        <span key={i} className="flex-1" style={{ background: colour }} />
      ))}
    </span>
  );
}

/** Put the board on screen on a Look: a design edit, which undoes with ⌘Z. */
export async function putBoardOnLook(boardId: string, name: string): Promise<void> {
  try {
    await mutate.updateBoard({ boardId, patch: { theme: name === "default" ? null : name } });
    useCanvas.getState().focusLook(null);
  } catch (err) {
    toastError(err, "Could not switch the look");
  }
}

/**
 * Every Look the design has, the board's own marked. Choosing one shows it
 * in the rail; putting the board on it is a separate, explicit step, so
 * browsing the Looks never changes how a board renders.
 */
export function LookList() {
  const boardId = useCanvas((s) => s.currentBoardId);
  const themeName = useCanvas((s) => s.themeName);
  const looks = useCanvas((s) => s.looks);
  const focus = useCanvas((s) => s.lookFocus);
  const refreshLooks = useCanvas((s) => s.refreshLooks);
  const focusLook = useCanvas((s) => s.focusLook);
  const [naming, setNaming] = useState(false);

  useEffect(() => {
    void refreshLooks().catch(() => {});
  }, [refreshLooks]);

  const shown = focus ?? themeName;
  // A Look an agent added since the last read still shows as the board's.
  const known = looks ?? [];
  const list: LookSummary[] = known.some((l) => l.name === themeName)
    ? known
    : [...known, { name: themeName, look: null, usedByBoards: [], swatch: [] }];

  return (
    <section aria-label="Looks" className="mb-3 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Looks</span>
        <Button
          variant="ghost"
          size="xs"
          className="ml-auto"
          onClick={() => setNaming(true)}
          disabled={!boardId}
        >
          <Plus />
          New look
        </Button>
      </div>
      <ItemGroup className="gap-1">
        {list.map((look) => {
          const onBoard = look.name === themeName;
          const boards = look.usedByBoards.length;
          return (
            <Item
              key={look.name}
              asChild
              size="xs"
              variant={look.name === shown ? "muted" : "default"}
              className="cursor-pointer text-left hover:bg-muted/50"
            >
              <button
                type="button"
                data-look={look.name}
                aria-current={look.name === shown ? "true" : undefined}
                onClick={() => focusLook(look.name)}
              >
                <ItemMedia variant="image">
                  <LookCover look={look} />
                </ItemMedia>
                <ItemContent className="gap-0 min-w-0">
                  <ItemTitle className="text-[13px]">{themeLabel(look.name)}</ItemTitle>
                  <ItemDescription className="text-[11px] truncate">
                    {look.look?.description ||
                      (boards === 0
                        ? "No board uses it"
                        : `${boards} board${boards === 1 ? "" : "s"}`)}
                  </ItemDescription>
                </ItemContent>
                {onBoard && boardId ? (
                  <ItemActions className="text-[10px] text-muted-foreground">
                    This board
                  </ItemActions>
                ) : null}
              </button>
            </Item>
          );
        })}
      </ItemGroup>
      <ExploreLookButton className="self-start" />
      {naming ? (
        <NewThemeDialog
          from={themeName}
          existing={list.map((l) => l.name)}
          onClose={() => setNaming(false)}
        />
      ) : null}
    </section>
  );
}
