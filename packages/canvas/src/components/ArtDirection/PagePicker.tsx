import type { ArtDirectionPageOption } from "@velloo/protocol";
import type { ArtDirectionPage } from "@velloo/schema";
import { useEffect, useState } from "react";
import { artDirection } from "../../api/art-direction.ts";
import { Field, FieldDescription, FieldLabel } from "../ui/field.tsx";
import { Input } from "../ui/input.tsx";
import { NativeSelect, NativeSelectOptGroup, NativeSelectOption } from "../ui/native-select.tsx";

const GROUPS: { kind: ArtDirectionPageOption["kind"]; label: string }[] = [
  { kind: "route", label: "Pages of the app" },
  { kind: "capture", label: "Captured pages" },
  { kind: "screen", label: "Screens on the canvas" },
];

const ASK = "ask";
const TYPED = "typed";

/**
 * Which page of the app to redesign: one of its routes, a page captured from
 * the browser, a screen already on the canvas, or one typed in. "Let my agent
 * ask" leaves it to the conversation.
 */
export function PagePicker({ onChange }: { onChange: (page: ArtDirectionPage | null) => void }) {
  const [options, setOptions] = useState<ArtDirectionPageOption[] | null>(null);
  const [choice, setChoice] = useState(ASK);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let alive = true;
    artDirection
      .pages()
      .then(({ pages }) => {
        if (!alive) return;
        setOptions(pages);
        const first = pages.findIndex((p) => p.kind === "route");
        if (first >= 0) {
          setChoice(String(first));
          onChange(pages[first]?.page ?? null);
        }
      })
      .catch(() => alive && setOptions([]));
    return () => {
      alive = false;
    };
  }, [onChange]);

  const pick = (value: string, text = typed) => {
    setChoice(value);
    if (value === ASK) onChange(null);
    else if (value === TYPED) onChange(text.trim() ? { label: text.trim() } : null);
    else onChange(options?.[Number(value)]?.page ?? null);
  };

  return (
    <Field>
      <FieldLabel htmlFor="art-direction-page">The page to redesign</FieldLabel>
      <NativeSelect
        id="art-direction-page"
        value={choice}
        disabled={options === null}
        onChange={(e) => pick(e.target.value)}
      >
        {GROUPS.map(({ kind, label }) => {
          const group = (options ?? [])
            .map((option, i) => ({ option, i }))
            .filter(({ option }) => option.kind === kind);
          return group.length > 0 ? (
            <NativeSelectOptGroup key={kind} label={label}>
              {group.map(({ option, i }) => (
                <NativeSelectOption key={i} value={String(i)}>
                  {option.page.label}
                  {option.detail ? `  ·  ${option.detail}` : ""}
                </NativeSelectOption>
              ))}
            </NativeSelectOptGroup>
          ) : null;
        })}
        <NativeSelectOptGroup label="Or">
          <NativeSelectOption value={TYPED}>Another page…</NativeSelectOption>
          <NativeSelectOption value={ASK}>Let my agent ask</NativeSelectOption>
        </NativeSelectOptGroup>
      </NativeSelect>
      {choice === TYPED ? (
        <Input
          autoFocus
          aria-label="Which page"
          placeholder="/pricing, or the settings page"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            pick(TYPED, e.target.value);
          }}
        />
      ) : null}
      <FieldDescription>
        {options === null
          ? "Looking for your app's pages…"
          : "Your agent reads it from the code, so every mock carries its real copy."}
      </FieldDescription>
    </Field>
  );
}
