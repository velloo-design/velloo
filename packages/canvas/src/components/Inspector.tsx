import { isComponentNode, isSnippetInstance, nodeId, type Theme } from "@velloo/schema";
import type { CatalogFont } from "@velloo/schema/fonts";
import { useEffect, useMemo, useState } from "react";
import { mutate, theme as theme_ } from "../api.ts";
import { useDebouncedCommit } from "../hooks/useDebouncedCommit.ts";
import { nodeRung, nodeTypography } from "../node-typography.ts";
import { pathFromString } from "../path.ts";
import { selectedNode, useCanvas } from "../store.ts";
import { toastError } from "../toast.ts";
import { CopyField } from "./CopyField.tsx";
import { IdField } from "./IdField.tsx";
import { ImagePanel } from "./ImagePanel.tsx";
import { PropField } from "./PropField.tsx";
import { SnippetInspector } from "./SnippetInspector.tsx";
import { SnippetSubstitutions } from "./SnippetSubstitutions.tsx";
import { StyleObjectEditor } from "./style-editor/StyleObjectEditor.tsx";
import { SxStyleEditor } from "./style-editor/SxStyleEditor.tsx";
import { TailwindStyleEditor } from "./style-editor/TailwindStyleEditor.tsx";
import { FontBrowser } from "./typography/FontBrowser.tsx";
import { assignSpec, leadFamily } from "./typography/FontsSection.tsx";
import { NodeTypographyReadout } from "./typography/NodeTypography.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

const DEBOUNCE_MS = 200;
const HIDDEN_PROPS = new Set(["className", "asChild", "children"]);

export function Inspector() {
  const selection = useCanvas((s) => s.selection);
  const components = useCanvas((s) => s.components);
  const screens = useCanvas((s) => s.screens);
  const styleChannel = useCanvas((s) => s.styleChannel);
  const channelsByLibrary = useCanvas((s) => s.channelsByLibrary);
  const theme = useCanvas((s) => s.theme);
  const themeName = useCanvas((s) => s.themeName);
  const loadComponents = useCanvas((s) => s.loadComponents);
  const loadGeneratedAssets = useCanvas((s) => s.loadGeneratedAssets);

  useEffect(() => {
    void loadComponents();
  }, [loadComponents]);

  useEffect(() => {
    void loadGeneratedAssets();
  }, [loadGeneratedAssets]);

  const [browsingFaces, setBrowsingFaces] = useState(false);
  const [pendingFace, setPendingFace] = useState<string | null>(null);

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

  // The active library's native style channel drives the editor: Tailwind
  // classes (shadcn / no-lib) vs an `sx` / `style` object (MUI). Resolve it for
  // the selected screen's library, falling back to the folder default.
  const screenLibrary = screens[selection.screenId]?.library;
  const channel = (screenLibrary ? channelsByLibrary[screenLibrary] : undefined) ?? styleChannel;
  const channelProp = channel?.prop ?? "className";
  const isObjectChannel = channel?.kind === "sx" || channel?.kind === "style";
  // Hide the channel prop from the generic prop list — it's edited below by the
  // dedicated field (so a MUI node's `sx` doesn't also show as a raw string prop).
  const hiddenProps = new Set([...HIDDEN_PROPS, channelProp]);

  const rung = nodeRung(node);
  const selectionKey = `${selection.screenId}:${selection.path}`;
  const initialClasses =
    typeof node.props?.className === "string" ? (node.props.className as string) : "";
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

  if (browsingFaces && theme) {
    // Open on the face already in play, so the list starts filtered to what
    // this rung is for and ticks what it currently uses.
    const facts = tree ? nodeTypography(theme, tree, pathFromString(selection.path), node) : null;
    const role =
      facts?.overrides.family?.replace(/^font-/, "") ??
      facts?.face.role ??
      facts?.face.slot ??
      "body";
    const stack = theme.typography.fontFamily?.[role];
    return (
      <div className="flex-1 min-h-0">
        <FontBrowser
          role={role}
          current={stack ? leadFamily(stack) : undefined}
          onBack={() => setBrowsingFaces(false)}
          onPick={(font) => {
            setBrowsingFaces(false);
            void declareFace(theme, themeName, font)
              .then(setPendingFace)
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

        {isObjectChannel ? (
          (() => {
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
        ) : (
          <TailwindStyleEditor
            key={`${selectionKey}:className`}
            initialValue={initialClasses}
            screenId={selection.screenId}
            path={selection.path}
            debounceMs={DEBOUNCE_MS}
            onBrowseFaces={() => setBrowsingFaces(true)}
            pendingFace={pendingFace}
            onFaceApplied={() => setPendingFace(null)}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Get a theme face for a browsed family and return the role to set on the node.
 *
 * A node never names a family directly. Declaring the face on the theme first
 * is what keeps `font-<role>` meaningful: re-point the role later and every node
 * set in it follows, which is the whole reason roles exist. It also puts the
 * webfont in one place — a family named only at a node would never be requested.
 */
async function declareFace(theme: Theme, themeName: string, font: CatalogFont): Promise<string> {
  const faces = theme.typography.fontFamily ?? {};
  // Reuse before declaring: picking Fraunces twice from two nodes should land
  // on one role, not `fraunces` and `fraunces-2`.
  const existing = Object.entries(faces).find(([, stack]) => leadFamily(stack) === font.family);
  if (existing) return existing[0];
  const role = freeRole(faceSlug(font.family), faces);
  await theme_.setFonts(themeName, [assignSpec(role, font)]);
  return role;
}

/** A family as a role name the schema accepts: `IBM Plex Sans` → `ibm-plex-sans`. */
function faceSlug(family: string): string {
  const slug = family
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(slug) ? slug : `font-${slug}`;
}

/** Never re-point a role someone else's nodes are already using. */
function freeRole(base: string, faces: Record<string, string>): string {
  if (!(base in faces)) return base;
  let n = 2;
  while (`${base}-${n}` in faces) n++;
  return `${base}-${n}`;
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
