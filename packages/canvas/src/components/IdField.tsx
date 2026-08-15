import { useState } from "react";
import { mutate } from "../api.ts";
import { pathFromString } from "../path.ts";
import { toastError } from "../toast.ts";
import { Input } from "./ui/input.tsx";

interface Props {
  initialValue: string;
  screenId: string;
  /** Dot-string path of the selected node. */
  path: string;
}

const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export function IdField({ initialValue, screenId, path }: Props) {
  const [draft, setDraft] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === initialValue) return;
    if (trimmed !== "" && !ID_RE.test(trimmed)) {
      setError("letters/digits/_/- only, leading letter");
      return;
    }
    setError(null);
    void mutate
      .setNodeId({
        screenId,
        path: pathFromString(path),
        id: trimmed === "" ? null : trimmed,
      })
      .catch((err) => {
        toastError(err, "Could not set node id");
        setDraft(initialValue);
      });
  };

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <label
        htmlFor="velloo-node-id"
        className="flex items-center justify-between text-muted-foreground uppercase tracking-wider"
      >
        <span>Stable id</span>
        {error ? <span className="normal-case text-destructive">{error}</span> : null}
      </label>
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground font-mono">@</span>
        <Input
          id="velloo-node-id"
          type="text"
          inputMode="text"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          placeholder="(none)"
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.currentTarget as HTMLInputElement).blur();
            } else if (e.key === "Escape") {
              setDraft(initialValue);
              setError(null);
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          aria-invalid={error !== null}
          className="flex-1 font-mono"
        />
      </div>
    </div>
  );
}
