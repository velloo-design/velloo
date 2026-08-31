import type { ViewportPreset } from "@velloo/schema";
import { useEffect, useState } from "react";
import { mutate } from "../api.ts";
import { useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

const FALLBACK_PRESETS: ViewportPreset[] = [
  { name: "Mobile", w: 390, h: 844 },
  { name: "Tablet", w: 768, h: 1024 },
  { name: "Desktop", w: 1440, h: 900 },
];

interface Props {
  /** Board to place the frame on; null = closed. */
  boardId: string | null;
  onClose: () => void;
}

/**
 * Board-level "add frame": place any existing screen on a board at a viewport
 * preset. The server auto-positions the frame right of the board's
 * rightmost frame; the `board-changed` broadcast makes it appear everywhere
 * without a reload.
 */
export function AddFrameDialog({ boardId, onClose }: Props) {
  const screens = useCanvas((s) => s.design?.screens ?? []);
  const presets = useCanvas((s) => {
    const fromConfig = s.design?.viewportPresets;
    return fromConfig && fromConfig.length > 0 ? fromConfig : FALLBACK_PRESETS;
  });
  const [screenId, setScreenId] = useState("");
  const [presetName, setPresetName] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: fresh defaults only when the dialog opens, not when the screen/preset lists refresh mid-edit
  useEffect(() => {
    if (boardId !== null) {
      setScreenId(screens[0]?.id ?? "");
      setPresetName(presets[presets.length - 1]?.name ?? "");
    }
  }, [boardId]);

  const submit = () => {
    const preset = presets.find((p) => p.name === presetName) ?? presets[0];
    if (!boardId || !screenId || !preset) return;
    onClose();
    void mutate
      .addFrame({ boardId, screenId, w: preset.w, h: preset.h })
      .catch((err) => toastError(err, "Could not add frame"));
  };

  return (
    <Dialog open={boardId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add frame</DialogTitle>
          <DialogDescription>
            Place an existing screen on this board. The frame lands next to the current ones.
          </DialogDescription>
        </DialogHeader>
        {screens.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No screens in this folder yet — ask your agent to design one first.
          </div>
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
      </DialogContent>
    </Dialog>
  );
}
