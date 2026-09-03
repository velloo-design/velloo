import type { ViewportPreset } from "@velloo/schema";
import { Check, Copy, Monitor, Plus, Smartphone, Tablet, Trash2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { config, type FolderConfig } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { pushToast, toastError } from "../../toast.ts";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Checkbox } from "../ui/checkbox.tsx";
import { Input } from "../ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { Switch } from "../ui/switch.tsx";
import { Fact, SectionLabel, SettingRow, SettingRows } from "./parts.tsx";

/** Sentinel for "no default" — Radix Select has no empty-string item value. */
const NONE = "__none__";

/** A rough device glyph for a preset, picked from its width. Decoration only. */
function presetIcon(w: number) {
  if (w < 600) return Smartphone;
  if (w < 1100) return Tablet;
  return Monitor;
}

/**
 * Folder scope — everything stored in the design folder's `config.json`.
 * Every control writes through a config mutation the moment it settles
 * (blur for text, change for pickers), so there is no Save button and no
 * dirty state to reconcile against an agent editing the same file.
 */
export function FolderPane({ cfg }: { cfg: FolderConfig }) {
  const boards = useCanvas((s) => s.design?.boards ?? []);
  const screens = useCanvas((s) => s.design?.screens ?? []);
  const reload = useCanvas((s) => s.loadFolderConfig);

  const boardId = useId();
  const screenId = useId();
  const aliasId = useId();
  const contactId = useId();

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      await reload();
    } catch (err) {
      toastError(err, label);
      // The server refused: re-read so the inputs snap back to what's stored.
      await reload().catch(() => {});
    }
  };

  return (
    <>
      <SectionLabel>Opens on</SectionLabel>
      <SettingRows>
        <SettingRow
          label="Board"
          description="The board the canvas shows on a fresh load."
          htmlFor={boardId}
        >
          <Select
            value={cfg.defaultBoard ?? NONE}
            onValueChange={(v) =>
              run("Could not set the default board", () =>
                config.defaults({ defaultBoard: v === NONE ? null : v }),
              )
            }
          >
            <SelectTrigger id={boardId} className="w-[252px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>First board in the sidebar</SelectItem>
              {boards.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow label="Screen" description="Focused after load. Optional." htmlFor={screenId}>
          <Select
            value={cfg.defaultScreen ?? NONE}
            onValueChange={(v) =>
              run("Could not set the default screen", () =>
                config.defaults({ defaultScreen: v === NONE ? null : v }),
              )
            }
          >
            <SelectTrigger id={screenId} className="w-[252px] text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No screen — fit the whole board</SelectItem>
              {screens.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
      </SettingRows>

      <div className="mt-5 flex items-baseline gap-2">
        <SectionLabel>Viewport presets</SectionLabel>
        <span className="text-[11.5px] text-muted-foreground">— offered when you add a frame</span>
      </div>
      <PresetEditor presets={cfg.viewportPresets} onCommit={run} />

      <SectionLabel className="mt-5">Code generation &amp; feedback</SectionLabel>
      <SettingRows>
        <SettingRow
          label="Components import alias"
          description="Prefix emit_code writes for library imports."
          htmlFor={aliasId}
        >
          <AliasField
            id={aliasId}
            value={cfg.componentsAlias}
            onCommit={(alias) =>
              run("Could not save the import alias", () =>
                config.codegen({ componentsAlias: alias }),
              )
            }
          />
        </SettingRow>
        <div className="py-2.5">
          <div className="flex items-center justify-between gap-6">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-foreground">Send product feedback</div>
              <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                Gives your agent the send_feedback tool. Off keeps velloo offline. Set once per repo
                — every design folder here shares this answer.
              </p>
            </div>
            <Switch
              aria-label="Send product feedback"
              checked={cfg.feedback.enabled}
              onCheckedChange={(enabled) =>
                run("Could not change the feedback setting", () => config.feedback({ enabled }))
              }
            />
          </div>
          {/* Consent is a property of the feedback itself, so it hangs off the
              switch rather than standing as a peer row — and it stays visible
              when feedback is off, because it records what was agreed to.
              Unlike the switch above it, this one is yours, not the repo's. */}
          <label
            htmlFor={contactId}
            className="mt-2 flex items-start gap-2 border-l-2 border-border pl-3"
          >
            <Checkbox
              id={contactId}
              className="mt-0.5 size-3.5"
              checked={cfg.feedback.contactOk}
              onCheckedChange={(v) =>
                run("Could not change the contact setting", () =>
                  config.feedback({ contactOk: v === true }),
                )
              }
            />
            <span className="min-w-0">
              <span className="block text-[12.5px] text-foreground">
                Velloo may contact me about what I send
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Attaches your account email to each report. Unchecked, feedback goes in anonymously.
                Saved on this machine, not in the repo — nobody who clones it inherits your answer.
              </span>
            </span>
          </label>
        </div>
      </SettingRows>

      <SectionLabel className="mt-5">What init decided</SectionLabel>
      <div className="mt-2 grid grid-cols-2 gap-x-8 gap-y-1.5 rounded-lg bg-muted/50 px-4 py-3">
        <Fact label="Library">
          <span className="truncate">{cfg.libraries[0]?.providerId ?? cfg.defaultLibrary}</span>
          {cfg.libraries[0] ? (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-normal">
              {cfg.libraries[0].source}
            </Badge>
          ) : null}
        </Fact>
        <Fact label="Styling">{cfg.styling === "none" ? "Inline styles" : "Tailwind"}</Fact>
        <Fact label="Format">
          schema v{cfg.schemaVersion} · velloo {cfg.toolVersion}
        </Fact>
        <Fact label="Cloud id">
          {cfg.folderId ? <CopyableId id={cfg.folderId} /> : <NotPublished />}
        </Fact>
      </div>
    </>
  );
}

function NotPublished() {
  return <span className="text-muted-foreground">Not published yet</span>;
}

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <span className="truncate font-mono text-[11px]">{id}</span>
      <button
        type="button"
        title="Copy folder id"
        className="shrink-0 text-muted-foreground hover:text-foreground"
        onClick={() => {
          void navigator.clipboard.writeText(id).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </>
  );
}

/**
 * Text input that only reports upward once the user is done — on blur or
 * Enter — so a per-keystroke mutation storm never reaches the folder.
 */
function AliasField({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: string | null;
  onCommit: (alias: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  // Adopt the stored value when it changes underneath us: an agent edit, or
  // our own write coming back refused.
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = () => {
    const next = draft.trim();
    if (next === (value ?? "")) return;
    onCommit(next === "" ? null : next);
  };
  return (
    <Input
      id={id}
      value={draft}
      placeholder="@/components/ui"
      className="h-8 w-[252px] font-mono text-[12.5px]"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(value ?? "");
      }}
    />
  );
}

interface KeyedPreset {
  key: number;
  preset: ViewportPreset;
}

let nextPresetKey = 0;
const keyed = (preset: ViewportPreset): KeyedPreset => ({ key: nextPresetKey++, preset });

/**
 * The preset list, edited in place. The whole list posts on every commit —
 * `update_viewport_presets` replaces it wholesale — and the draft resets from
 * the server's answer, so a rejected edit (duplicate name, empty name) snaps
 * back instead of lingering.
 */
function PresetEditor({
  presets,
  onCommit,
}: {
  presets: ViewportPreset[];
  onCommit: (label: string, fn: () => Promise<unknown>) => Promise<void>;
}) {
  // Rows carry a synthetic key so React keeps an input's DOM node (and its
  // caret) attached to the row being renamed, not to its position.
  const [draft, setDraft] = useState(() => presets.map(keyed));
  useEffect(() => setDraft(presets.map(keyed)), [presets]);

  const rows = draft.map((r) => r.preset);
  const save = (next: KeyedPreset[]) => {
    setDraft(next);
    void onCommit("Could not save the viewport presets", () =>
      config.viewportPresets(next.map((r) => r.preset)),
    );
  };
  const patch = (key: number, p: Partial<ViewportPreset>) =>
    setDraft(draft.map((r) => (r.key === key ? { key, preset: { ...r.preset, ...p } } : r)));
  const commitDraft = () => {
    if (JSON.stringify(rows) === JSON.stringify(presets)) return;
    // Half-typed rows (a cleared name, a cleared number) are a normal state
    // mid-edit, not a server error — say so here and restore what's stored.
    if (rows.some((p) => p.name.trim() === "" || p.w <= 0 || p.h <= 0)) {
      pushToast({
        kind: "error",
        message: "A viewport preset needs a name and a positive width and height.",
      });
      setDraft(presets.map(keyed));
      return;
    }
    save(draft);
  };

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border">
      {draft.map(({ key, preset }, i) => {
        const Glyph = presetIcon(preset.w);
        return (
          <div
            key={key}
            className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0"
          >
            <Glyph className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={preset.name}
              aria-label={`Preset ${i + 1} name`}
              className="h-7 w-40 text-[13px]"
              onChange={(e) => patch(key, { name: e.target.value })}
              onBlur={commitDraft}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
            <div className="ml-auto flex items-center gap-1.5">
              <SizeField
                label={`Preset ${i + 1} width`}
                value={preset.w}
                onChange={(w) => patch(key, { w })}
                onCommit={commitDraft}
              />
              <span className="text-[11px] text-muted-foreground">×</span>
              <SizeField
                label={`Preset ${i + 1} height`}
                value={preset.h}
                onChange={(h) => patch(key, { h })}
                onCommit={commitDraft}
              />
            </div>
            <button
              type="button"
              // The schema requires one preset; disabling beats a failed write.
              disabled={draft.length <= 1}
              title={
                draft.length <= 1 ? "At least one preset is required." : `Remove ${preset.name}`
              }
              className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-40 disabled:hover:text-muted-foreground"
              onClick={() => save(draft.filter((r) => r.key !== key))}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        );
      })}
      <div className="flex items-center gap-3 border-t border-border px-3 py-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[12.5px] text-muted-foreground"
          onClick={() => save([...draft, keyed({ name: uniqueName(rows), w: 1440, h: 900 })])}
        >
          <Plus className="size-3.5" />
          Add preset
        </Button>
        <span className="ml-auto text-[11px] text-muted-foreground">
          At least one preset is required.
        </span>
      </div>
    </div>
  );
}

/** "New preset", then "New preset 2", … — the server rejects duplicates. */
function uniqueName(presets: ViewportPreset[]): string {
  const taken = new Set(presets.map((p) => p.name.toLowerCase()));
  if (!taken.has("new preset")) return "New preset";
  for (let n = 2; ; n++) {
    const candidate = `New preset ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function SizeField({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  onCommit: () => void;
}) {
  return (
    <Input
      aria-label={label}
      inputMode="numeric"
      value={String(value)}
      className="h-7 w-[68px] text-center font-mono text-[12px]"
      onChange={(e) => {
        const n = Number.parseInt(e.target.value, 10);
        onChange(Number.isFinite(n) && n > 0 ? n : 0);
      }}
      onBlur={onCommit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
