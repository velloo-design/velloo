/**
 * The contextual bar that replaced the inspector's style sections.
 *
 * It floats over the canvas under the selection rather than living in a side
 * pane, shows only the handful of controls that apply to what's selected, and
 * says where every value came from. What it deliberately can't do is the
 * devtools half of the old panel — display, position, flex, raw classes. Those
 * are the agent's job; this is for the fine-tuning pass afterwards.
 */

import { isComponentNode, isSnippetInstance } from "@velloo/schema";
import { Component, Image as ImageIcon, PenLine, Shapes, Square, Type } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useIconNames } from "../../hooks/useIconNames.ts";
import { useSelectionRects } from "../../hooks/useSelectionRects.ts";
import { computedValues } from "../../hud/computed.ts";
import {
  barControls,
  type Choice,
  type ControlSpec,
  colorChoices,
  fontChoices,
  type NodeRole,
  resolveColorToken,
  resolveControls,
} from "../../hud/control-set.ts";
import { themeReadout } from "../../hud/theme-values.ts";
import { useControlWrite, type WriteContext } from "../../hud/use-control-write.ts";
import {
  type ControlValue,
  classNameOf,
  readControl,
  sizeChoiceOf,
  sizeFixedPx,
} from "../../hud/values.ts";
import { nodeRung } from "../../node-typography.ts";
import { pathFromString } from "../../path.ts";
import { selectedNode, useCanvas } from "../../store.ts";
import { ImagePanel } from "../ImagePanel.tsx";
import { Badge } from "../ui/badge.tsx";
import { Button } from "../ui/button.tsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog.tsx";
import { Separator } from "../ui/separator.tsx";
import { TooltipProvider } from "../ui/tooltip.tsx";
import {
  AlignField,
  ChoiceField,
  ColorField,
  HudField,
  IconField,
  NumberField,
  OpenerField,
  SizeField,
  TextField,
  ToggleField,
} from "./fields.tsx";

/** Sentinel choice in the Font control that hands off to the face browser. */
const BROWSE_FACES = "__browse";

const ROLE_ICON: Record<NodeRole, typeof Type> = {
  heading: Type,
  text: PenLine,
  box: Square,
  image: ImageIcon,
  icon: Shapes,
  snippet: Component,
  other: Component,
};

export function NodeHud() {
  const selection = useCanvas((s) => s.selection);
  const cursorMode = useCanvas((s) => s.cursorMode);
  const wsConnected = useCanvas((s) => s.wsConnected);
  const screens = useCanvas((s) => s.screens);
  const theme = useCanvas((s) => s.theme);
  const styleChannel = useCanvas((s) => s.styleChannel);
  const channelsByLibrary = useCanvas((s) => s.channelsByLibrary);
  const components = useCanvas((s) => s.components);
  const design = useCanvas((s) => s.design);
  const openSnippetEditor = useCanvas((s) => s.openSnippetEditor);
  const setBrowsingFaces = useCanvas((s) => s.setBrowsingFaces);
  const setRightTab = useCanvas((s) => s.setRightTab);
  const setRightPaneCollapsed = useCanvas((s) => s.setRightPaneCollapsed);
  const setSnippetFocus = useCanvas((s) => s.setSnippetFocus);
  const snippetFocus = useCanvas((s) => s.snippetFocus);
  const rects = useSelectionRects();
  const iconNames = useIconNames();
  const [promptOpen, setPromptOpen] = useState(false);

  const node = useMemo(() => selectedNode(screens, selection), [screens, selection]);
  const tree = selection ? screens[selection.screenId]?.tree : undefined;

  const descriptor = useMemo(() => {
    if (!node || !components || !isComponentNode(node)) return null;
    return components.find((c) => c.id === node.$ref) ?? null;
  }, [node, components]);

  const snippetMeta = useMemo(() => {
    if (!node || !isSnippetInstance(node)) return null;
    return design?.snippets.find((s) => s.id === node.$snippet) ?? null;
  }, [node, design]);

  // A folder styled through `sx` or an inline `style` object doesn't speak
  // classes, so the style half of the bar would write somewhere nothing reads.
  // Those folders keep the object editor in the side pane; the bar still
  // carries their props and snippet args.
  const screenLibrary = selection ? screens[selection.screenId]?.library : undefined;
  const channel = (screenLibrary ? channelsByLibrary[screenLibrary] : undefined) ?? styleChannel;
  const classChannel = channel === null || channel.kind === "tailwind-classname";

  const resolved = useMemo(() => {
    if (!node) return null;
    const all = resolveControls({ node, descriptor, snippet: snippetMeta });
    const usable = classChannel ? all.controls : all.controls.filter((c) => c.slot.via !== "style");
    return { ...all, controls: barControls(usable) };
  }, [node, descriptor, snippetMeta, classChannel]);

  const readout = useMemo(() => {
    if (!node || !selection) return { values: {} };
    return themeReadout({ theme, tree, path: pathFromString(selection.path), node });
  }, [theme, tree, selection, node]);

  const selectionComputed = useCanvas((s) => s.selectionComputed);
  const computed = useMemo(() => computedValues(selectionComputed), [selectionComputed]);

  const colors = useMemo(() => colorChoices(theme), [theme]);
  const resolveColor = useCallback(
    (token: string | null) => resolveColorToken(theme, token),
    [theme],
  );
  // The theme's declared roles, plus a way out of them: a family that isn't a
  // role yet gets declared as one on the way in, so the node still only ever
  // says `font-<role>`.
  const fonts = useMemo(
    () => [...fontChoices(theme), { value: BROWSE_FACES, label: "Browse fonts…" }],
    [theme],
  );

  // --------------------------------------------------------------- commits

  const commit = useControlWrite({ selection, node, liveClasses: node ? classNameOf(node) : "" });

  const write = useCallback(
    (spec: ControlSpec, value: string | number | boolean | null, ctx?: WriteContext) => {
      // The font control's escape hatch: a face that isn't a theme role yet
      // gets declared as one, which needs the browser in the side pane.
      if (value === BROWSE_FACES) {
        setRightTab("node");
        setRightPaneCollapsed(false);
        setBrowsingFaces(true);
        return;
      }
      commit(spec, value, ctx);
    },
    [commit, setBrowsingFaces, setRightTab, setRightPaneCollapsed],
  );

  // ---------------------------------------------------------------- render

  if (cursorMode !== "select") return null;
  if (snippetFocus !== null && (!selection || !node || !resolved)) {
    // Focused but nothing picked yet — the mode itself still needs a way out
    // and an explanation of why the rest of the screen went grey.
    return (
      <FocusStrip
        name={design?.snippets.find((s) => s.id === snippetFocus)?.name ?? snippetFocus}
        onDone={() => setSnippetFocus(null)}
      >
        <span className="self-center text-xs text-muted-foreground">
          Pick anything inside it — every instance changes together.
        </span>
      </FocusStrip>
    );
  }
  if (!selection || !node || !resolved) return null;

  const measured = rects[0] ?? null;
  const snippetId = isSnippetInstance(node) ? node.$snippet : null;
  const RoleIcon = ROLE_ICON[resolved.role];
  const rung = nodeRung(node);
  const typeName = isSnippetInstance(node)
    ? (snippetMeta?.name ?? node.$snippet)
    : isComponentNode(node)
      ? node.$ref
      : "Param";
  const imageSrc =
    isComponentNode(node) && typeof node.props?.src === "string" ? node.props.src : null;

  const inBody = selection.screenId.startsWith("snippet:");

  return (
    <TooltipProvider delayDuration={300}>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex flex-col items-center gap-1.5 px-6">
        {snippetFocus !== null ? (
          <FocusBanner
            name={design?.snippets.find((s) => s.id === snippetFocus)?.name ?? snippetFocus}
            onDone={() => setSnippetFocus(null)}
          />
        ) : null}
        <div
          className={`pointer-events-auto flex max-w-full items-stretch gap-2 rounded-xl border bg-card/95 p-2 shadow-xl backdrop-blur-sm ${
            resolved.role === "snippet" || inBody ? "border-violet-400/70" : ""
          } ${wsConnected ? "" : "pointer-events-none opacity-50"}`}
          data-velloo-hud
        >
          <div className="flex shrink-0 items-center gap-1.5 self-center pr-1 pl-0.5">
            <RoleIcon
              size={14}
              className={resolved.role === "snippet" ? "text-violet-500" : "text-muted-foreground"}
            />
            <span className="max-w-[140px] truncate text-xs font-medium">{typeName}</span>
            {inBody ? (
              <Badge className="bg-violet-500/15 px-1 py-0 text-[10px] text-violet-600 dark:text-violet-300">
                in snippet
              </Badge>
            ) : null}
            {rung ? (
              <Badge variant="secondary" className="px-1 py-0 text-[10px]">
                {rung}
              </Badge>
            ) : null}
          </div>

          <Separator orientation="vertical" className="shrink-0 self-stretch" />

          {snippetId !== null ? (
            <div className="flex shrink-0 items-center gap-2 self-center">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => openSnippetEditor(snippetId)}
              >
                Edit snippet
              </Button>
              <Button
                size="sm"
                variant={snippetFocus === snippetId ? "default" : "ghost"}
                className="h-7 text-xs"
                onClick={() => setSnippetFocus(snippetFocus === snippetId ? null : snippetId)}
                title="Edit this snippet in place — every instance updates together"
              >
                {snippetFocus === snippetId ? "Done" : "Edit in place"}
              </Button>
              {resolved.controls.length > 0 ? (
                <Separator orientation="vertical" className="self-stretch" />
              ) : null}
            </div>
          ) : null}

          <div className="flex min-w-0 items-start gap-2 overflow-x-auto">
            {resolved.controls.map((spec) => {
              const value = readControl(spec, {
                node,
                themeValues: readout.values,
                themeSource: readout.source,
                computed,
              });
              return (
                <HudField
                  key={spec.id}
                  label={spec.label}
                  origin={value.origin}
                  themeValue={value.themeValue}
                  source={value.source}
                  width={spec.width}
                  note={readout.notes?.[spec.id]}
                  onReset={value.origin === "changed" ? () => write(spec, null) : undefined}
                >
                  <Control
                    spec={spec}
                    value={value}
                    colors={colors}
                    resolveColor={resolveColor}
                    fonts={fonts}
                    iconNames={iconNames}
                    measured={
                      spec.slot.via === "style" && spec.slot.key === "height"
                        ? (measured?.h ?? null)
                        : (measured?.w ?? null)
                    }
                    onOpenPrompt={() => setPromptOpen(true)}
                    onChange={(next, ctx) => write(spec, next, ctx)}
                  />
                </HudField>
              );
            })}
            {resolved.controls.length === 0 ? (
              <button
                type="button"
                className="grid h-[42px] place-items-center px-3 text-xs text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => {
                  setRightTab("node");
                  setRightPaneCollapsed(false);
                }}
              >
                Nothing to tune here — open the panel
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog open={promptOpen} onOpenChange={setPromptOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Image</DialogTitle>
          </DialogHeader>
          {imageSrc !== null ? (
            <ImagePanel screenId={selection.screenId} path={selection.path} src={imageSrc} />
          ) : null}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

/**
 * The mode line above the bar. Snippet focus changes what an edit means — one
 * click now moves every instance — so it says so continuously rather than
 * relying on the dimming to be self-explanatory.
 */
function FocusBanner({ name, onDone }: { name: string; onDone(): void }) {
  return (
    <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-violet-400/70 bg-card/95 py-1 pr-1 pl-3 text-xs shadow-lg backdrop-blur-sm">
      <Component size={12} className="text-violet-500" />
      <span>
        Editing <span className="font-medium">{name}</span> — every instance updates together
      </span>
      <Button size="sm" variant="ghost" className="h-6 rounded-full px-2 text-xs" onClick={onDone}>
        Done
      </Button>
    </div>
  );
}

function FocusStrip({
  name,
  onDone,
  children,
}: {
  name: string;
  onDone(): void;
  children: React.ReactNode;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex flex-col items-center gap-1.5 px-6">
      <FocusBanner name={name} onDone={onDone} />
      <div
        className="pointer-events-auto flex items-stretch gap-2 rounded-xl border border-violet-400/70 bg-card/95 px-3 py-2 shadow-xl backdrop-blur-sm"
        data-velloo-hud
        onPointerDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export interface ControlProps {
  spec: ControlSpec;
  value: ControlValue;
  colors: readonly Choice[];
  resolveColor(token: string | null): string | null;
  fonts: readonly Choice[];
  iconNames: string[];
  measured: number | null;
  onOpenPrompt(): void;
  onChange(next: string | number | boolean | null, ctx?: WriteContext): void;
}

/** One control, wired to its kind. The chrome around it is HudField's job. */
export function Control({
  spec,
  value,
  colors,
  resolveColor,
  fonts,
  iconNames,
  measured,
  onOpenPrompt,
  onChange,
}: ControlProps) {
  const asString = value.value === null ? null : String(value.value);
  const asNumber = typeof value.value === "number" ? value.value : null;
  // What to show when the node names nothing: the theme's value if it has an
  // opinion, else what the slot actually resolves to in the browser. Both ride
  // the `ghost` channel, which every field already renders greyed.
  const ghost = value.themeValue ?? value.computed ?? null;
  const ghostString = ghost === null ? null : String(ghost);
  // Nothing the node itself says reads as an edit — a theme default and a
  // resolved default both show dimmed, so the field says "this is what it is"
  // rather than "this is what you chose".
  const muted = !value.authored;

  switch (spec.kind) {
    case "number":
      return (
        <NumberField
          value={asNumber}
          ghost={ghost}
          muted={muted}
          onChange={onChange}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
        />
      );
    case "ratio":
      return (
        <NumberField
          value={asNumber}
          ghost={ghost}
          muted={muted}
          onChange={onChange}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 0.05}
          gear={8}
          suffix="×"
        />
      );
    case "size": {
      const mode = sizeChoiceOf(asString ?? undefined);
      return (
        <SizeField
          mode={mode}
          px={sizeFixedPx(asString ?? undefined)}
          measured={measured === null ? null : Math.round(measured)}
          muted={muted}
          choices={spec.choices ?? []}
          onMode={(next) =>
            onChange(next === "fixed" ? `[${Math.round(measured ?? 100)}px]` : next)
          }
          onPx={(px, ctx) => onChange(`[${px}px]`, ctx)}
        />
      );
    }
    case "choice":
      return (
        <ChoiceField
          value={asString}
          ghost={ghostString}
          muted={muted}
          choices={spec.choices ?? []}
          onChange={onChange}
        />
      );
    case "align":
      return (
        <AlignField
          value={asString}
          ghost={ghostString}
          muted={muted}
          choices={spec.choices ?? []}
          onChange={onChange}
        />
      );
    case "color":
      return (
        <ColorField
          value={asString}
          ghost={ghostString}
          muted={muted}
          choices={colors}
          resolve={resolveColor}
          onChange={onChange}
        />
      );
    case "font":
      return (
        <ChoiceField
          value={asString}
          ghost={ghostString}
          muted={muted}
          choices={fonts}
          onChange={onChange}
        />
      );
    case "icon":
      return <IconField value={asString ?? ""} options={iconNames} onChange={onChange} />;
    case "text":
      return <TextField value={asString ?? ""} onChange={onChange} />;
    case "toggle":
      return <ToggleField value={value.value === true} onChange={onChange} />;
    case "prompt":
      return <OpenerField summary={asString} onOpen={onOpenPrompt} />;
  }
}
