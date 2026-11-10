import type { ArtDirectionPageOption } from "@velloo/protocol";
import type { ArtDirectionPage } from "@velloo/schema";
import { useEffect, useState } from "react";
import { artDirection } from "../../api/art-direction.ts";
import { PageChooser } from "../PageChooser.tsx";
import { Field, FieldDescription, FieldLabel } from "../ui/field.tsx";

const GROUPS: Record<ArtDirectionPageOption["kind"], string> = {
  route: "Pages of the app",
  capture: "Captured pages",
  screen: "Screens on the canvas",
};

/**
 * Which page of the app to redesign: one of its routes, a page captured from
 * the browser or a screen already on the canvas, or one typed in. Left empty,
 * the agent asks.
 */
export function PagePicker({ onChange }: { onChange: (page: ArtDirectionPage | null) => void }) {
  const [options, setOptions] = useState<ArtDirectionPageOption[] | null>(null);
  const [mode, setMode] = useState<"pick" | "type">("pick");
  const [value, setValue] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let alive = true;
    artDirection
      .pages()
      .then(({ pages }) => {
        if (!alive) return;
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
      <FieldLabel htmlFor="art-direction-page">The page to redesign</FieldLabel>
      <PageChooser
        id="art-direction-page"
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
            : "Your agent reads it from the code, so every mock carries its real copy."}
      </FieldDescription>
    </Field>
  );
}
