import { type ComponentNode, isComponentNode, type Node } from "@velloo/schema";
import { useState } from "react";
import { postMutate } from "../api/http.ts";
import { mutate } from "../api.ts";
import { pathFromString } from "../path.ts";
import { type Selection, useCanvas } from "../store.ts";
import { pushToast, toastError } from "../toast.ts";
import { Button } from "./ui/button.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";

const SNIPPET_PREFIX = "snippet:";

interface Props {
  selection: Selection;
  node: ComponentNode;
}

/**
 * Snippet-body substitution inserters — only rendered when the Inspector is
 * editing a node inside a snippet body (`snippet:<id>` virtual screen).
 *
 * "+ param ref" appends a `{"$param": "<name>"}` slot to the selected node's
 * children (node-typed params only — a scalar param in a node position renders
 * as nothing). "+ if branch" wraps a prop's current value in
 * `{"$if": <param>, "then": <current>, "else": ""}` keyed on a boolean param.
 * Both used to require the agent or a hand-edit of the snippet JSON.
 */
export function SnippetSubstitutions({ selection, node }: Props) {
  const design = useCanvas((s) => s.design);
  const syntheticScreen = useCanvas((s) => s.screens[selection.screenId]);

  const snippetId = selection.screenId.slice(SNIPPET_PREFIX.length);
  const params = design?.snippets.find((s) => s.id === snippetId)?.params ?? [];
  const nodeParams = params.filter((p) => p.type === "node");
  const boolParams = params.filter((p) => p.type === "boolean");

  const insertParamRef = async (name: string) => {
    if (!syntheticScreen) return;
    // The body edit is a definition change, so it goes through
    // update_snippet with the full tree — the synthetic screen already
    // holds the current body, we just append the slot to the selection.
    const tree = structuredClone(syntheticScreen.tree);
    let target: Node | undefined = tree;
    for (const idx of pathFromString(selection.path)) {
      if (!target || !isComponentNode(target)) return;
      target = target.children?.[idx];
    }
    if (!target || !isComponentNode(target)) return;
    target.children = [...(target.children ?? []), { $param: name }];
    try {
      await postMutate("update_snippet", { snippetId, patch: { tree } });
      pushToast({ kind: "success", message: `Inserted {$param: ${name}} slot` });
    } catch (err) {
      toastError(err, "Could not insert param ref");
    }
  };

  const wrapInIfBranch = async (prop: string, param: string) => {
    const current = node.props?.[prop];
    try {
      await mutate.updateProps({
        screenId: selection.screenId,
        path: pathFromString(selection.path),
        propPatch: { [prop]: { $if: param, then: current ?? "", else: "" } },
      });
      pushToast({ kind: "success", message: `${prop} now branches on {$if: ${param}}` });
    } catch (err) {
      toastError(err, "Could not add if branch");
    }
  };

  return (
    <section className="flex flex-col gap-3 border-t pt-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Substitutions</div>
      <ParamRefRow nodeParams={nodeParams.map((p) => p.name)} onInsert={insertParamRef} />
      <IfBranchRow node={node} boolParams={boolParams.map((p) => p.name)} onWrap={wrapInIfBranch} />
    </section>
  );
}

function ParamRefRow({
  nodeParams,
  onInsert,
}: {
  nodeParams: string[];
  onInsert: (name: string) => void;
}) {
  if (nodeParams.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">+ param ref</span> — this snippet has no{" "}
        <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-muted">node</code> param to
        slot in. Ask your agent to declare one.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">+ param ref</Label>
      {/* value stays "" so the trigger re-arms after each insert. */}
      <Select value="" onValueChange={onInsert}>
        <SelectTrigger size="sm" className="text-xs" aria-label="Insert a param-ref slot">
          <SelectValue placeholder="Insert {$param} slot as child…" />
        </SelectTrigger>
        <SelectContent>
          {nodeParams.map((name) => (
            <SelectItem key={name} value={name}>
              {`{$param: ${name}}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function IfBranchRow({
  node,
  boolParams,
  onWrap,
}: {
  node: ComponentNode;
  boolParams: string[];
  onWrap: (prop: string, param: string) => void;
}) {
  const [prop, setProp] = useState("");
  const [param, setParam] = useState("");

  if (boolParams.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">+ if branch</span> — this snippet has no{" "}
        <code className="text-[10px] font-mono px-1 py-0.5 rounded bg-muted">boolean</code> param to
        branch on. Ask your agent to declare one.
      </div>
    );
  }

  // Candidate props: className plus the node's own scalar-valued props. The
  // `children` PROP is offered only when the node has no child subtrees (a
  // children array wins over the prop, so wrapping it there would be inert).
  const candidates = new Set<string>(["className"]);
  if (!node.children || node.children.length === 0) candidates.add("children");
  for (const [key, value] of Object.entries(node.props ?? {})) {
    if (key === "asChild") continue;
    if (value === null || typeof value !== "object") candidates.add(key);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs">+ if branch</Label>
      <div className="flex items-center gap-1.5">
        <Select value={prop} onValueChange={setProp}>
          <SelectTrigger size="sm" className="flex-1 text-xs" aria-label="Prop to branch">
            <SelectValue placeholder="prop" />
          </SelectTrigger>
          <SelectContent>
            {[...candidates].map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={param} onValueChange={setParam}>
          <SelectTrigger size="sm" className="flex-1 text-xs" aria-label="Boolean param">
            <SelectValue placeholder="$if param" />
          </SelectTrigger>
          <SelectContent>
            {boolParams.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="xs"
          variant="outline"
          className="h-7 text-xs shrink-0"
          disabled={prop === "" || param === ""}
          onClick={() => {
            onWrap(prop, param);
            setProp("");
            setParam("");
          }}
        >
          Wrap
        </Button>
      </div>
      <div className="text-[10px] text-muted-foreground leading-relaxed">
        Wraps the prop's current value in <code className="font-mono">{"{$if, then, else}"}</code> —
        tune the branches in the prop field after.
      </div>
    </div>
  );
}
