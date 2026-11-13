import type { LookSummary, UpdateLookBody } from "@velloo/protocol";
import type { Look, LookSource } from "@velloo/schema";
import { BookImage } from "lucide-react";
import { useEffect, useState } from "react";
import { theme as themeApi } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { themeLabel } from "../theme-label.ts";
import { Button } from "../ui/button.tsx";
import { Field, FieldDescription, FieldLabel } from "../ui/field.tsx";
import { Input } from "../ui/input.tsx";
import { Textarea } from "../ui/textarea.tsx";
import { LookImagery } from "./LookImagery.tsx";
import { putBoardOnLook } from "./LookList.tsx";

const lines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** Write one part of a Look; the daemon's broadcast brings the rail up to date. */
function save(name: string, patch: Omit<UpdateLookBody, "theme" | "fromSketchbook">) {
  void themeApi
    .updateLook({ theme: name, ...patch })
    .then(() => useCanvas.getState().refreshLooks())
    .catch((err) => toastError(err, "Could not save the look"));
}

/**
 * A text box that saves when it is left, and follows the saved value when an
 * agent changes it meanwhile — unless the person is typing in it.
 */
function useDraft(saved: string): [string, (v: string) => void, (focused: boolean) => void] {
  const [draft, setDraft] = useState(saved);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(saved);
  }, [saved, editing]);
  return [draft, setDraft, setEditing];
}

function DraftText({
  id,
  label,
  help,
  saved,
  placeholder,
  multiline,
  onSave,
}: {
  id: string;
  label: string;
  help?: string;
  saved: string;
  placeholder: string;
  multiline?: boolean;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft, setEditing] = useDraft(saved);
  const props = {
    id,
    value: draft,
    placeholder,
    onFocus: () => setEditing(true),
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: () => {
      setEditing(false);
      if (draft.trim() !== saved.trim()) onSave(draft);
    },
  };
  return (
    <Field className="gap-1.5">
      <FieldLabel htmlFor={id} className="text-xs">
        {label}
      </FieldLabel>
      {multiline ? (
        <Textarea {...props} className="min-h-12 text-xs md:text-xs" />
      ) : (
        <Input {...props} className="h-8 text-xs md:text-xs" />
      )}
      {help ? <FieldDescription className="text-[11px]">{help}</FieldDescription> : null}
    </Field>
  );
}

/** The sketchbook the Look came from, opened on the direction's mood board. */
function OriginLink({ origin }: { origin: LookSource }) {
  const sketchbooks = useCanvas((s) => s.sketchbooks);
  useEffect(() => {
    if (sketchbooks === null) {
      void useCanvas
        .getState()
        .loadSketchbooks()
        .catch(() => {});
    }
  }, [sketchbooks]);
  const known = sketchbooks?.find((s) => s.id === origin.sketchbook);
  if (sketchbooks !== null && !known) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Made in a sketchbook that has since been deleted.
      </p>
    );
  }
  const open = async () => {
    const { openSketchbook, setSketchbookStep } = useCanvas.getState();
    await openSketchbook(origin.sketchbook);
    setSketchbookStep("boards");
    // The step renders after the sketchbook arrives; wait for the direction's card.
    for (let i = 0; i < 20; i++) {
      const card = document.querySelector(`[data-direction="${CSS.escape(origin.direction)}"]`);
      if (card) {
        card.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  };
  return (
    <Button
      variant="link"
      size="xs"
      className="h-auto justify-start px-0 text-[11px]"
      data-look-origin
      onClick={() => void open().catch((err) => toastError(err, "Could not open the sketchbook"))}
    >
      <BookImage />
      From {known ? `“${known.name}”` : "a sketchbook"}, {origin.direction}
    </Button>
  );
}

/**
 * The head of the Look the rail shows: whether the board is on it, where it
 * came from and its one line. Its imagery and rules are sections of their own
 * beside the token controls.
 */
export function LookHeader({ summary, onBoard }: { summary: LookSummary; onBoard: boolean }) {
  const boardId = useCanvas((s) => s.currentBoardId);
  const name = summary.name;
  return (
    <div className="mb-3 flex flex-col gap-2" data-look-details={name}>
      {onBoard ? null : (
        <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-2">
          <p className="text-[11px] leading-snug text-muted-foreground">
            This board uses another look. Put it on {themeLabel(name)} to edit its colour, type and
            shape here.
          </p>
          <Button
            size="xs"
            variant="outline"
            disabled={!boardId}
            onClick={() => boardId && void putBoardOnLook(boardId, name)}
          >
            Use on this board
          </Button>
        </div>
      )}
      {summary.look?.origin ? <OriginLink origin={summary.look.origin} /> : null}
      <DraftText
        id={`look-description-${name}`}
        label="Description"
        saved={summary.look?.description ?? ""}
        placeholder="The look in one line"
        onSave={(description) => save(name, { description })}
      />
    </div>
  );
}

/** The images a Look came from, and how its imagery is drawn. */
export function LookImagerySection({ name, look }: { name: string; look: Look | null }) {
  const images = look?.images ?? [];
  return (
    <div className="flex flex-col gap-2">
      {images.length > 0 ? (
        <LookImagery images={images} />
      ) : (
        <p className="text-[11px] text-muted-foreground">
          No images. A look made from a sketchbook direction keeps its mood board and mocks.
        </p>
      )}
      <DraftText
        id={`look-imagery-${name}`}
        label="Imagery style"
        help="How its photographs and illustrations are drawn. Image generation reads it."
        saved={look?.imagery ?? ""}
        placeholder="Two-colour screen prints, grain, flat light"
        multiline
        onSave={(imagery) => save(name, { imagery })}
      />
    </div>
  );
}

/** A Look's own do's and don'ts, one per line. */
export function LookRulesSection({ name, look }: { name: string; look: Look | null }) {
  return (
    <div className="flex flex-col gap-2">
      <DraftText
        id={`look-dos-${name}`}
        label="Do"
        saved={(look?.rules.dos ?? []).join("\n")}
        placeholder="One rule per line"
        multiline
        onSave={(text) => save(name, { rules: { dos: lines(text) } })}
      />
      <DraftText
        id={`look-donts-${name}`}
        label="Don't"
        help="They sit over the design's own rules."
        saved={(look?.rules.donts ?? []).join("\n")}
        placeholder="One rule per line"
        multiline
        onSave={(text) => save(name, { rules: { donts: lines(text) } })}
      />
    </div>
  );
}
