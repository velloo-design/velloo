import type { SketchbookPageOption } from "@velloo/protocol";
import type { SketchbookPage } from "@velloo/schema";
import { useEffect, useState } from "react";
import { sketchbook } from "../../api/sketchbook.ts";
import { PageChooser } from "../PageChooser.tsx";
import { Field, FieldDescription, FieldLabel } from "../ui/field.tsx";

const GROUPS: Record<SketchbookPageOption["kind"], string> = {
  route: "Pages of the app",
  capture: "Captured pages",
  screen: "Screens on the canvas",
};

/**
 * Whether the design is bound to an app that exists: only then is there a
 * page to port or redesign. Null while it is being read.
 */
export function useHasApp(): boolean | null {
  const [hasApp, setHasApp] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    sketchbook
      .pages()
      .then((r) => alive && setHasApp(r.hasApp))
      .catch(() => alive && setHasApp(false));
    return () => {
      alive = false;
    };
  }, []);
  return hasApp;
}

/**
 * Which page of the app to redesign: one of its routes, a page captured from
 * the browser or a screen already on the canvas, or one typed in. Left empty,
 * the agent asks. `only` narrows the kinds listed (porting offers no screens).
 */
export function PagePicker({
  onChange,
  label = "The page to redesign",
  only,
  hint = "Your agent reads it from the code, so every mock carries its real copy.",
}: {
  onChange: (page: SketchbookPage | null) => void;
  label?: string;
  only?: SketchbookPageOption["kind"][];
  /** What the description says once a page can be picked from the list. */
  hint?: string;
}) {
  const [options, setOptions] = useState<SketchbookPageOption[] | null>(null);
  const [mode, setMode] = useState<"pick" | "type">("pick");
  const [value, setValue] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: read once per mount; `only` is a literal at each call site
  useEffect(() => {
    let alive = true;
    sketchbook
      .pages()
      .then(({ pages: all }) => {
        if (!alive) return;
        const pages = only ? all.filter((p) => only.includes(p.kind)) : all;
        setOptions(pages);
        if (pages.length === 0) setMode("type");
      })
      .catch(() => {
        if (!alive) return;
        setOptions([]);
        setMode("type");
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (mode === "type") onChange(typed.trim() ? { label: typed.trim() } : null);
    else onChange(value === null ? null : (options?.[Number(value)]?.page ?? null));
  }, [mode, value, typed, options, onChange]);

  return (
    <Field>
      <FieldLabel htmlFor="sketchbook-page">{label}</FieldLabel>
      <PageChooser
        id="sketchbook-page"
        options={(options ?? []).map((o, i) => ({
          value: String(i),
          label: o.page.label,
          detail: o.detail,
          group: GROUPS[o.kind],
        }))}
        mode={mode}
        onMode={setMode}
        value={value}
        onValue={setValue}
        typed={typed}
        onTyped={setTyped}
        typedPlaceholder="/pricing, or the settings page"
      />
      <FieldDescription>
        {options === null
          ? "Looking for your app's pages…"
          : mode === "type"
            ? "Leave it empty and your agent asks which page."
            : hint}
      </FieldDescription>
    </Field>
  );
}
