import { namedPaletteRoles, type Theme } from "@velloo/schema";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { theme as themeApi } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { ColorSwatch } from "../ColorSwatch.tsx";
import { providerName } from "../Settings/library-facts.ts";
import { COLOR_SLOTS, ThemeColorSlots } from "../ThemeColors.tsx";
import { Button } from "../ui/button.tsx";
import { Field, FieldDescription, FieldLabel } from "../ui/field.tsx";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "../ui/input-group.tsx";
import { ToggleGroup, ToggleGroupItem } from "../ui/toggle-group.tsx";

/** A typed name as the theme stores one: "Brand soft" → `brand-soft`. */
function roleName(typed: string): string {
  return typed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The colour roles, in the palette being worked on.
 *
 * Light and dark are one switch for this list and whatever is showing the
 * theme beside it — the stage's specimen, or the board: the colours being
 * edited are the colours on show. A dark value starts as its
 * light one and becomes its own the moment it is changed.
 *
 * Which roles there are comes from two places. The framework's own components
 * read a fixed set — Material UI has no accent or ring — so those lead, named
 * as such. The rest are still real colours a design can use. And a design can
 * add roles of its own, each with a light and a dark value.
 */
interface Props {
  theme: Theme;
  scheme: "light" | "dark";
  /** Whoever owns the preview owns the scheme: the stage's specimen, or the board. */
  onSchemeChange: (scheme: "light" | "dark") => void;
}

export function RolesEditor({ theme, scheme, onSchemeChange: setScheme }: Props) {
  const themeName = useCanvas((s) => s.themeName);
  const frameworkRoles = useCanvas((s) => s.frameworkRoles);
  const framework = useCanvas((s) => providerName(s.design?.providerId ?? ""));
  const [draft, setDraft] = useState("");
  const dark = scheme === "dark";

  const used = frameworkRoles ? new Set(frameworkRoles) : null;
  const unused = used ? new Set(COLOR_SLOTS.map((s) => s.key).filter((k) => !used.has(k))) : null;
  const custom = namedPaletteRoles(theme);
  const primary = theme.colors.primary;
  const seed = typeof primary === "string" ? primary : primary.DEFAULT;

  const add = () => {
    const name = roleName(draft);
    if (name === "") return;
    setDraft("");
    void themeApi
      .setRole(themeName, { name, light: seed, dark: seed })
      .catch((err) => toastError(err, "Could not add the role"));
  };

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="w-full"
        value={scheme}
        onValueChange={(v) => {
          if (v === "light" || v === "dark") setScheme(v);
        }}
      >
        <ToggleGroupItem value="light" className="flex-1 text-xs">
          Light
        </ToggleGroupItem>
        <ToggleGroupItem value="dark" className="flex-1 text-xs">
          Dark
        </ToggleGroupItem>
      </ToggleGroup>
      {dark && !theme.colorsDark ? (
        <p className="text-xs text-muted-foreground">
          This theme has no dark palette yet, so dark shows the light colours. Change one and it
          becomes the first dark colour — or pick a starting point above to get a whole palette.
        </p>
      ) : null}

      {used ? (
        <>
          <Field>
            <FieldLabel>Used by {framework}'s components</FieldLabel>
            <ThemeColorSlots theme={theme} scheme={scheme} only={used} />
          </Field>
          {unused && unused.size > 0 ? (
            <Field>
              <FieldLabel>For your own designs</FieldLabel>
              <FieldDescription className="text-xs">
                {framework} has no place for these, but a design can still use them.
              </FieldDescription>
              <ThemeColorSlots theme={theme} scheme={scheme} only={unused} />
            </Field>
          ) : null}
        </>
      ) : (
        <ThemeColorSlots theme={theme} scheme={scheme} />
      )}

      <Field>
        <FieldLabel htmlFor="language-custom-role">Custom roles</FieldLabel>
        {custom.map((name) => {
          const light = theme.palette?.[name];
          const value = (dark ? theme.paletteDark?.[name] : light) ?? light ?? "";
          return (
            <ColorSwatch
              key={name}
              label={name}
              tokenPath={`${dark ? "paletteDark" : "palette"}.${name}`}
              value={value}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove the ${name} role`}
                onClick={() =>
                  void themeApi
                    .removeRole(themeName, name)
                    .catch((err) => toastError(err, "Could not remove the role"))
                }
              >
                <Trash2 />
              </Button>
            </ColorSwatch>
          );
        })}
        <InputGroup>
          <InputGroupInput
            id="language-custom-role"
            value={draft}
            placeholder={custom.length === 0 ? "e.g. success, tertiary" : "Add another"}
            className="text-xs"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label="Add custom role"
              disabled={roleName(draft) === ""}
              onClick={add}
            >
              <Plus />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <FieldDescription className="text-xs">
          A role of your own gets a light and a dark colour — switch above to set each. Designs use
          it by name; the library's components do not know it.
        </FieldDescription>
      </Field>
    </div>
  );
}
