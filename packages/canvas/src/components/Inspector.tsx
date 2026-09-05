import { isComponentNode, isSnippetInstance, nodeId } from "@velloo/schema";
import { useEffect, useMemo } from "react";
import { mutate } from "../api.ts";
import { useDebouncedCommit } from "../hooks/useDebouncedCommit.ts";
import { useSelectionRects } from "../hooks/useSelectionRects.ts";
import { computedValues } from "../hud/computed.ts";
import { resolveControls } from "../hud/control-set.ts";
import { useControlWrite } from "../hud/use-control-write.ts";
import { applyStyleValue, classNameOf } from "../hud/values.ts";
import { nodeRung, nodeTypography } from "../node-typography.ts";
import { pathFromString } from "../path.ts";
import { selectedNode, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { CopyField } from "./CopyField.tsx";
import { NodeStyleSection } from "./hud/NodeStyleSection.tsx";
import { IdField } from "./IdField.tsx";
import { ImagePanel } from "./ImagePanel.tsx";
import { PropField } from "./PropField.tsx";
import { SnippetInspector } from "./SnippetInspector.tsx";
import { SnippetSubstitutions } from "./SnippetSubstitutions.tsx";
import { StyleObjectEditor } from "./style-editor/StyleObjectEditor.tsx";
import { SxStyleEditor } from "./style-editor/SxStyleEditor.tsx";
import { declareFace } from "./typography/declare-face.ts";
import { FontBrowser } from "./typography/FontBrowser.tsx";
import { leadFamily } from "./typography/FontsSection.tsx";
import { NodeTypographyReadout } from "./typography/NodeTypography.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

const DEBOUNCE_MS = 200;
const HIDDEN_PROPS = new Set(["className", "asChild", "children"]);

export function Inspector() {
  const selection = useCanvas((s) => s.selection);
  const selectionComputed = useCanvas((s) => s.selectionComputed);
  const selectionRects = useSelectionRects();
  const components = useCanvas((s) => s.components);
  const screens = useCanvas((s) => s.screens);
  const styleChannel = useCanvas((s) => s.styleChannel);
  const channelsByLibrary = useCanvas((s) => s.channelsByLibrary);
  const theme = useCanvas((s) => s.theme);
  const themeName = useCanvas((s) => s.themeName);
  const browsingFaces = useCanvas((s) => s.browsingFaces);
  const setBrowsingFaces = useCanvas((s) => s.setBrowsingFaces);
  const loadComponents = useCanvas((s) => s.loadComponents);
  const loadGeneratedAssets = useCanvas((s) => s.loadGeneratedAssets);

  useEffect(() => {
    void loadComponents();
  }, [loadComponents]);

  useEffect(() => {
    void loadGeneratedAssets();
  }, [loadGeneratedAssets]);

  const node = useMemo(() => selectedNode(screens, selection), [screens, selection]);
  // The screen root, for the typeset-region ancestor walk — a typeset applies to
  // a subtree, so the node alone can't say which one it renders under.
  const tree = selection ? screens[selection.screenId]?.tree : undefined;
  const descriptor = useMemo(() => {
    if (!node || !components || !isComponentNode(node)) return null;
    return components.find((c) => c.id === node.$ref) ?? null;
  }, [node, components]);

  // The payload captures screenId/path at edit time, so a selection change
  // inside the debounce window can't redirect a pending commit.
  const pushProp = useDebouncedCommit<{
    screenId: string;
    path: string;
    name: string;
    value: unknown;
  }>(DEBOUNCE_MS, (p) => {
    void mutate
      .updateProps({
        screenId: p.screenId,
        path: pathFromString(p.path),
        propPatch: { [p.name]: p.value === undefined ? null : p.value },
      })
      .catch((err) => toastError(err, "Could not update prop"));
  });

  // The pane's style controls are the bar's, so they commit through the same
  // path — including the touched-slot replay that keeps fast edits from
  // clobbering each other.
  const commitControl = useControlWrite({
    selection,
    node,
    liveClasses: node ? classNameOf(node) : "",
  });

  // What the node's untouched slots actually resolve to — the pane shows those
  // greyed rather than a dash, same as the bar.
  const computed = computedValues(selectionComputed);
  const measuredRect = selectionRects[0] ?? null;

  if (!selection) {
    return (
      <div className="flex-1 grid place-items-center text-xs text-muted-foreground p-6 text-center">
        Click a node in the canvas to edit its props.
      </div>
    );
  }

  if (!node) {
    return (
      <div className="flex-1 grid place-items-center text-xs text-muted-foreground p-6 text-center">
        Selected node is no longer in the tree.
      </div>
    );
  }

  if (isSnippetInstance(node)) {
    return <SnippetInspector selection={selection} node={node} />;
  }

  if (!isComponentNode(node)) {
    return (
      <div className="flex-1 grid place-items-center text-xs text-muted-foreground p-6 text-center">
        $param placeholders are only addressable inside a snippet body — open the snippet to edit.
      </div>
    );
  }

  const commitProp = (name: string, value: unknown) =>
    pushProp({ screenId: selection.screenId, path: selection.path, name, value });

  // Styling for a Tailwind folder now lives in the HUD over the canvas; what
  // stays here is the object channel (MUI `sx`, inline `style`), which the HUD
  // doesn't speak. Resolve the channel for the selected screen's library,
  // falling back to the folder default.
  const screenLibrary = screens[selection.screenId]?.library;
  const channel = (screenLibrary ? channelsByLibrary[screenLibrary] : undefined) ?? styleChannel;
  const channelProp = channel?.prop ?? "className";
  const isObjectChannel = channel?.kind === "sx" || channel?.kind === "style";
  // Hide the channel prop from the generic prop list — it's edited below by the
  // dedicated field (so a MUI node's `sx` doesn't also show as a raw string prop).
  // Props the Style section already offers are hidden for the same reason: two
  // fields writing one prop is a way to make an edit look like it didn't take.
  const hiddenProps = new Set([
    ...HIDDEN_PROPS,
    channelProp,
    ...resolveControls({ node, descriptor })
      .controls.map((c) => (c.slot.via === "prop" ? c.slot.name : null))
      .filter((n): n is string => n !== null),
  ]);

  const rung = nodeRung(node);
  const selectionKey = `${selection.screenId}:${selection.path}`;
  const childrenValue =
    typeof node.props?.children === "string" ? (node.props.children as string) : "";
  const showCopy = typeof node.props?.children === "string" || descriptor === null;
  // The image panel keys on the node carrying a src, not on `$ref === "Image"`:
  // every provider names its image component differently, and a node with a
  // src is exactly the node a generated asset can be swapped into.
  const imageSrc = typeof node.props?.src === "string" ? (node.props.src as string) : null;
  // ValueField deliberately keeps its draft across store updates so an
  // in-progress edit never snaps back — but the image panel repoints `src`
  // while the selection stays put, so without the src in the key the Src field
  // would keep showing the asset that was just replaced.
  const propsKey = `${selectionKey}:${imageSrc ?? ""}`;

  // Opened from the HUD's Font control. Picking a family declares it as a
  // theme face first, then points this node at that role — a node never names
  // a family directly, so `font-<role>` stays the only thing on the element.
  if (browsingFaces && theme) {
    const facts = tree ? nodeTypography(theme, tree, pathFromString(selection.path), node) : null;
    const currentRole =
      facts?.overrides.family?.replace(/^font-/, "") ??
      facts?.face.role ??
      facts?.face.slot ??
      "body";
    const stack = theme.typography.fontFamily?.[currentRole];
    return (
      <div className="flex-1 min-h-0">
        <FontBrowser
          role={currentRole}
          current={stack ? leadFamily(stack) : undefined}
          onBack={() => setBrowsingFaces(false)}
          onPick={(font) => {
            setBrowsingFaces(false);
            const target = selection;
            void declareFace(theme, themeName, font)
              .then((role) =>
                mutate.applyClasses({
                  screenId: target.screenId,
                  path: pathFromString(target.path),
                  classes: applyStyleValue(
                    typeof node.props?.className === "string" ? node.props.className : "",
                    "fontFamily",
                    role,
                  ),
                }),
              )
              .catch((err) => toastError(err, "Could not set the face"));
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-4 py-3 border-b">
        <div className="font-semibold text-sm truncate">
          {node.$ref}
          {rung ? (
            <span className="ml-1.5 font-mono text-xs text-muted-foreground">{rung}</span>
          ) : null}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5">
          {selection.screenId} · {selection.path === "" ? "(root)" : selection.path}
        </div>
      </header>

      <StatePreview key={selectionKey} />

      <div className="flex-1 overflow-y-auto scroll-stable p-4 flex flex-col gap-4">
        <IdField
          key={`${selectionKey}:id`}
          initialValue={nodeId(node) ?? ""}
          screenId={selection.screenId}
          path={selection.path}
        />

        {showCopy ? (
          <CopyField
            key={`${selectionKey}:children`}
            initialValue={childrenValue}
            screenId={selection.screenId}
            path={selection.path}
            debounceMs={DEBOUNCE_MS}
          />
        ) : null}

        {imageSrc !== null ? (
          <ImagePanel
            key={`${selectionKey}:image`}
            screenId={selection.screenId}
            path={selection.path}
            src={imageSrc}
            nodeAspect={typeof node.props?.aspect === "string" ? node.props.aspect : undefined}
          />
        ) : null}

        <section className="flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Style</div>
          <NodeStyleSection
            key={`${selectionKey}:style`}
            node={node}
            tree={tree}
            path={selection.path}
            theme={theme}
            descriptor={descriptor}
            snippet={null}
            classChannel={!isObjectChannel}
            computed={computed}
            measured={measuredRect}
            onChange={commitControl}
          />
        </section>

        {theme && tree ? (
          <NodeTypographyReadout
            theme={theme}
            tree={tree}
            path={pathFromString(selection.path)}
            node={node}
          />
        ) : null}

        {descriptor && descriptor.props.filter((p) => !hiddenProps.has(p.name)).length > 0 ? (
          <section className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Props</div>
            {descriptor.props
              .filter((p) => !hiddenProps.has(p.name))
              .map((p) => (
                <PropField
                  key={`${propsKey}:${p.name}`}
                  descriptor={p}
                  initialValue={node.props?.[p.name]}
                  onChange={(v) => commitProp(p.name, v)}
                />
              ))}
          </section>
        ) : null}

        {selection.screenId.startsWith("snippet:") ? (
          <SnippetSubstitutions key={`${selectionKey}:subs`} selection={selection} node={node} />
        ) : null}

        {isObjectChannel
          ? (() => {
              const objValue =
                node.props?.[channelProp] && typeof node.props[channelProp] === "object"
                  ? (node.props[channelProp] as Record<string, unknown>)
                  : undefined;
              const editorProps = {
                key: `${selectionKey}:${channelProp}`,
                initialValue: objValue,
                prop: channelProp,
                screenId: selection.screenId,
                path: selection.path,
                debounceMs: DEBOUNCE_MS,
              };
              return channel?.kind === "sx" ? (
                <SxStyleEditor {...editorProps} />
              ) : (
                <StyleObjectEditor {...editorProps} />
              );
            })()
          : null}
      </div>
    </div>
  );
}

const STATES = ["default", "hover", "focus", "active", "disabled"] as const;

function StatePreview() {
  const nodeState = useCanvas((s) => s.nodeState);
  const setNodeState = useCanvas((s) => s.setNodeState);

  useEffect(() => {
    setNodeState("default");
    return () => setNodeState("default");
  }, [setNodeState]);

  return (
    <div className="px-4 py-2 border-b flex items-center gap-2">
      <Label
        htmlFor="node-state"
        className="text-xs uppercase tracking-wider text-muted-foreground"
      >
        State
      </Label>
      <Select value={nodeState} onValueChange={(v) => setNodeState(v as typeof nodeState)}>
        <SelectTrigger id="node-state" size="sm" className="flex-1 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATES.map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
