import { Info, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { type AppTheme, useCanvas } from "../../store.ts";
import { pushToast } from "../../toast.ts";
import { Button } from "../ui/button.tsx";
import { Switch } from "../ui/switch.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";
import { SectionLabel, SettingRow, SettingRows } from "./parts.tsx";

/**
 * Canvas scope — the preferences that belong to this browser, not to the
 * design folder. Nothing here is a mutation: it all lands in localStorage,
 * which is why the pane says so in its header and footer.
 */
export function CanvasPane() {
  const appTheme = useCanvas((s) => s.appTheme);
  const setAppTheme = useCanvas((s) => s.setAppTheme);
  const designMode = useCanvas((s) => s.designMode);
  const rememberDesignMode = useCanvas((s) => s.rememberDesignMode);
  const setRememberDesignMode = useCanvas((s) => s.setRememberDesignMode);
  const rememberPanels = useCanvas((s) => s.rememberPanels);
  const setRememberPanels = useCanvas((s) => s.setRememberPanels);
  const resetCanvasPrefs = useCanvas((s) => s.resetCanvasPrefs);

  return (
    <>
      <SectionLabel>Appearance</SectionLabel>
      <SettingRows>
        <SettingRow
          label="App theme"
          description="Velloo's own chrome — the toolbar, sidebar, and panels."
        >
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={appTheme}
            aria-label="App theme"
            // Radix clears the value when you click the active item; keep the
            // last choice rather than falling into an unset theme.
            onValueChange={(v) => v && setAppTheme(v as AppTheme)}
          >
            <ToggleGroupItem value="light" className="px-3 text-[12px]">
              <Sun className="size-3.5" />
              Light
            </ToggleGroupItem>
            <ToggleGroupItem value="dark" className="px-3 text-[12px]">
              <Moon className="size-3.5" />
              Dark
            </ToggleGroupItem>
            <ToggleGroupItem value="system" className="px-3 text-[12px]">
              <Monitor className="size-3.5" />
              System
            </ToggleGroupItem>
          </ToggleGroup>
        </SettingRow>
        <SettingRow
          label="Remember the design preset"
          description="Reopen the canvas in whichever preset you last used. Off means every reload starts light."
        >
          <span className="flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-1 text-[11.5px] text-muted-foreground">
            {designMode === "dark" ? <Moon className="size-3.5" /> : <Sun className="size-3.5" />}
            now: {designMode}
          </span>
          <Switch
            aria-label="Remember the design preset"
            checked={rememberDesignMode}
            onCheckedChange={setRememberDesignMode}
          />
        </SettingRow>
      </SettingRows>

      <SectionLabel className="mt-5">Layout</SectionLabel>
      <SettingRows>
        <SettingRow
          label="Remember panel layout"
          description="Side pane widths and collapse, boards list, and screen tree stay as you left them."
        >
          <Switch
            aria-label="Remember panel layout"
            checked={rememberPanels}
            onCheckedChange={setRememberPanels}
          />
        </SettingRow>
      </SettingRows>

      <div className="mt-5 flex items-start gap-3 rounded-lg border border-border bg-muted/30 p-3">
        <RotateCcw className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-foreground">Reset canvas preferences</div>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
            Clears theme and panel memory for this browser. Your design is untouched.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 shrink-0 text-[12.5px]"
          onClick={() => {
            resetCanvasPrefs();
            pushToast({ kind: "success", message: "Canvas preferences reset." });
          }}
        >
          Reset
        </Button>
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
        <Info className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-[11.5px] text-muted-foreground">
          Signing in, credits, and reverting live in the account menu, top right.
        </span>
      </div>
    </>
  );
}
