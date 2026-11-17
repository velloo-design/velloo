import { Import, Plus, SwatchBook } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "../EmptyState.tsx";
import { useHasApp } from "../Sketchbook/PagePicker.tsx";
import { Button } from "../ui/button.tsx";
import { AddScreenDialog } from "./AddScreenDialog.tsx";
import type { ScreenStart } from "./ways.ts";

/** A board with no frames yet: the ways its first screen can start. */
export function EmptyBoard({ board }: { board: { id: string; name: string } }) {
  const hasApp = useHasApp();
  const [start, setStart] = useState<ScreenStart | null>(null);
  return (
    <>
      <EmptyState
        title={`Board "${board.name}" is empty`}
        hint={
          hasApp
            ? "Start a screen blank, from one of your looks, or from a page of your app. Your agent can also design here whenever you ask."
            : "Start a screen blank or from one of your looks. Your agent can also design here whenever you ask."
        }
        action={
          <div className="flex flex-wrap justify-center gap-2" data-empty-board-starts>
            <Button variant="outline" onClick={() => setStart("blank")}>
              <Plus />
              Blank
            </Button>
            <Button variant="outline" onClick={() => setStart("look")}>
              <SwatchBook />
              From a theme look
            </Button>
            {hasApp ? (
              <Button variant="outline" onClick={() => setStart("port")}>
                <Import />
                Port from app
              </Button>
            ) : null}
          </div>
        }
      />
      <AddScreenDialog
        boardId={start ? board.id : null}
        start={start ?? "blank"}
        onClose={() => setStart(null)}
      />
    </>
  );
}
