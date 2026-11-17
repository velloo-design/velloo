import type { SketchbookPage } from "@velloo/schema";
import { ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import { mutate } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { useViewportPresets } from "../../viewport-presets.ts";
import { LookCover } from "../Looks/LookList.tsx";
import { PagePicker, useHasApp } from "../Sketchbook/PagePicker.tsx";
import { SketchbookMark } from "../Sketchbook/SketchbookMark.tsx";
import { themeLabel } from "../theme-label.ts";
import { Button } from "../ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.tsx";
import { Field, FieldLabel } from "../ui/field.tsx";
import { Input } from "../ui/input.tsx";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "../ui/item.tsx";
import { Label } from "../ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";
import {
  designInLook,
  exploreLooksForNew,
  looksToStartFrom,
  PORTABLE,
  portPage,
  type ScreenStart,
} from "./ways.ts";

interface Props {
  /** Board the screen goes on; null = closed. */
  boardId: string | null;
  /** The way it opens on. */
  start?: ScreenStart | undefined;
  onClose: () => void;
}

/**
 * A new screen on a board, three ways: blank (place a screen the design has),
 * from one of the design's Looks, or ported from a page of the app. The last
 * two are agent work, handed over with a card the way Restyle is, so the
 * person always sees which agent runs it before it does.
 */
export function AddScreenDialog({ boardId, start = "blank", onClose }: Props) {
  const [way, setWay] = useState<ScreenStart>(start);
  const hasApp = useHasApp();

  useEffect(() => {
    if (boardId !== null) setWay(start === "port" && hasApp === false ? "blank" : start);
  }, [boardId, start, hasApp]);

  return (
    <Dialog open={boardId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-add-screen>
        <DialogHeader>
          <DialogTitle>Add a screen</DialogTitle>
          <DialogDescription>
            {hasApp
              ? "Start it blank, from one of your looks, or from a page of your app."
              : "Start it blank, or from one of your looks."}
          </DialogDescription>
        </DialogHeader>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={way}
          onValueChange={(next) => (next ? setWay(next as ScreenStart) : null)}
          className="self-start"
          aria-label="How to start the screen"
        >
          <ToggleGroupItem value="blank">Blank</ToggleGroupItem>
          <ToggleGroupItem value="look">From a look</ToggleGroupItem>
          {hasApp ? <ToggleGroupItem value="port">Port from app</ToggleGroupItem> : null}
        </ToggleGroup>
        {boardId === null ? null : way === "look" ? (
          <FromLook boardId={boardId} onClose={onClose} />
        ) : way === "port" ? (
          <FromApp boardId={boardId} onClose={onClose} />
        ) : (
          <Blank boardId={boardId} onClose={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Place a screen the design already has, at a viewport preset: the server positions the frame. */
function Blank({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const screens = useCanvas((s) => s.design?.screens ?? []);
  const presets = useViewportPresets();
  const [screenId, setScreenId] = useState(() => screens[0]?.id ?? "");
  const [presetName, setPresetName] = useState(() => presets[presets.length - 1]?.name ?? "");

  const submit = () => {
    const preset = presets.find((p) => p.name === presetName) ?? presets[0];
    if (!screenId || !preset) return;
    onClose();
    void mutate
      .addFrame({ boardId, screenId, w: preset.w, h: preset.h })
      .catch((err) => toastError(err, "Could not add frame"));
  };

  return (
    <>
      {screens.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No screens in this design yet. Ask your agent to design one here, or start from a look.
        </p>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="add-frame-screen" className="text-xs">
              Screen
            </Label>
            <Select value={screenId} onValueChange={setScreenId}>
              <SelectTrigger id="add-frame-screen" className="w-full">
                <SelectValue placeholder="Pick a screen" />
              </SelectTrigger>
              <SelectContent>
                {screens.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="add-frame-size" className="text-xs">
              Size
            </Label>
            <Select value={presetName} onValueChange={setPresetName}>
              <SelectTrigger id="add-frame-size" className="w-full">
                <SelectValue placeholder="Pick a size" />
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.name} value={p.name}>
                    {p.name} — {p.w}×{p.h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={submit} disabled={!screenId || !presetName}>
          Add frame
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Pick a Look: the board is put on it and an agent designs the screen from
 * its imagery and rules. Or find a new one in a sketchbook first.
 */
function FromLook({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const looks = useCanvas((s) => s.looks);
  const refreshLooks = useCanvas((s) => s.refreshLooks);
  const current = useCanvas((s) => s.boards[boardId]?.theme);
  const [what, setWhat] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    void refreshLooks().catch(() => {});
  }, [refreshLooks]);

  const list = looksToStartFrom(looks);
  const chosen = picked ?? current ?? null;

  // Closed at once: what follows (reading the agents, the picker) can take a moment, and shows itself.
  const run = (work: () => Promise<void>, failure: string) => {
    onClose();
    void work().catch((err) => toastError(err, failure));
  };

  return (
    <>
      <Field>
        <FieldLabel htmlFor="add-screen-what">What should it be?</FieldLabel>
        <Input
          id="add-screen-what"
          value={what}
          onChange={(e) => setWhat(e.target.value)}
          placeholder="A pricing page with three plans"
        />
      </Field>
      <section aria-label="Your theme looks" className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Start from a theme look</span>
        <ItemGroup className="max-h-64 gap-1 overflow-y-auto">
          {list.map((look) => (
            <Item
              key={look.name}
              asChild
              size="xs"
              variant={look.name === chosen ? "muted" : "default"}
              className="cursor-pointer text-left hover:bg-muted/50"
            >
              <button
                type="button"
                data-start-look={look.name}
                aria-pressed={look.name === chosen}
                onClick={() => setPicked(look.name)}
              >
                <ItemMedia variant="image">
                  <LookCover look={look} />
                </ItemMedia>
                <ItemContent className="min-w-0 gap-0">
                  <ItemTitle className="text-[13px]">{themeLabel(look.name)}</ItemTitle>
                  <ItemDescription className="truncate text-[11px]">
                    {look.look?.description ||
                      (look.look?.images.length
                        ? `${look.look.images.length} image${look.look.images.length === 1 ? "" : "s"}`
                        : "Colours and type")}
                  </ItemDescription>
                </ItemContent>
              </button>
            </Item>
          ))}
          <Item
            asChild
            size="xs"
            variant="outline"
            className="cursor-pointer text-left hover:bg-muted/50"
          >
            <button
              type="button"
              data-explore-new-looks
              onClick={() =>
                run(() => exploreLooksForNew(boardId, what), "Could not start a sketchbook")
              }
            >
              <ItemMedia variant="icon">
                <SketchbookMark className="size-[18px]" />
              </ItemMedia>
              <ItemContent className="min-w-0 gap-0">
                <ItemTitle className="text-[13px]">Explore new theme looks</ItemTitle>
                <ItemDescription className="text-[11px]">
                  See directions as mood boards and mocks in a sketchbook first.
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </ItemActions>
            </button>
          </Item>
        </ItemGroup>
      </section>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!chosen}
          onClick={() =>
            chosen &&
            run(() => designInLook(boardId, chosen, what), "Could not start from the theme look")
          }
        >
          Design it
        </Button>
      </DialogFooter>
    </>
  );
}

/** Pick a page of the app (or name one): an agent ports it onto the board. */
function FromApp({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const [page, setPage] = useState<SketchbookPage | null>(null);
  return (
    <>
      <PagePicker
        onChange={setPage}
        label="The page to port"
        only={PORTABLE}
        hint="Your agent rebuilds it here from its code, with your components."
      />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          type="button"
          disabled={!page}
          onClick={() => {
            if (!page) return;
            onClose();
            void portPage(boardId, page).catch((err) => toastError(err, "Could not ask the agent"));
          }}
        >
          Port it
        </Button>
      </DialogFooter>
    </>
  );
}
