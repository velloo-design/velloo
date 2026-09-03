import type { Theme } from "@velloo/schema";
import { type CatalogFont, catalogFont, type FontRole } from "@velloo/schema/fonts";
import { Check, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { type FontSpec, theme as themeApi } from "../../api.ts";
import { requestPreviewFace } from "../../font-preview.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog.tsx";
import { Input } from "../ui/input.tsx";

/** Roles a folder is likely to want next, offered when naming a new one. */
const SUGGESTED_ROLES: Array<{ role: string; hint: FontRole }> = [
  { role: "display", hint: "display" },
  { role: "serif", hint: "body" },
  { role: "sans", hint: "body" },
  { role: "mono", hint: "mono" },
];

const ROLE_PATTERN = /^[a-z][a-z0-9-]*$/;

/** The family a stack leads with, for the row's label and the browser's tick. */
export function leadFamily(stack: string): string {
  return /^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(stack)?.slice(1).find(Boolean)?.trim() ?? stack;
}

/** A stack that leads with a generic — the OS picks the face, not the theme. */
const SYSTEM_LEAD = /^(-|ui-|system-ui$|sans-serif$|serif$|monospace$|cursive$)/;

interface Props {
  theme: Theme;
  /** Opens the browser drill-down for a role. */
  onBrowse: (role: string) => void;
}

/**
 * The folder's font roles: what each one is set in, and how to add or drop one.
 *
 * Roles are the unit here rather than families, because everything downstream
 * names a role — `--font-display`, the `font-display` utility, a typeset's
 * `fontHeading`. Swapping the family behind a role re-faces every one of them
 * at once, which is the property that makes the whole thing worth having.
 */
export function FontsSection({ theme, onBrowse }: Props) {
  const families = theme.typography.fontFamily ?? {};
  const roles = Object.keys(families).sort();
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const refreshTheme = useCanvas((s) => s.refreshTheme);
  const themeName = useCanvas((s) => s.themeName);

  // The frames get the committed faces from the theme's own link tag, but the
  // rail is a different document — without this the rows naming a webfont would
  // be the one place in the product that can't show it.
  useEffect(() => {
    for (const stack of Object.values(families)) {
      const known = catalogFont(leadFamily(stack));
      if (known) requestPreviewFace(known.family, known.google);
    }
  }, [families]);

  const send = (spec: FontSpec) => {
    void themeApi.setFonts(themeName, [spec]).catch((err) => {
      toastError(err, "Could not update the font role");
      void refreshTheme();
    });
  };

  const trimmed = draft.trim();
  const valid = ROLE_PATTERN.test(trimmed) && !roles.includes(trimmed);

  const startBrowsing = (role: string) => {
    setNaming(false);
    onBrowse(role);
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        {roles.length === 0 ? (
          <p className="text-xs text-muted-foreground">No faces declared yet.</p>
        ) : (
          roles.map((role) => {
            const stack = families[role] as string;
            const family = leadFamily(stack);
            const known = catalogFont(family);
            // A generic-led stack names no face at all — the OS picks one — so
            // printing `-apple-system` would be reporting plumbing as a choice.
            const system = SYSTEM_LEAD.test(family);
            return (
              <div key={role} className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onBrowse(role)}
                  title={stack}
                  className="min-w-0 flex-1 flex items-baseline gap-2 rounded-md border border-input bg-background px-2 py-1.5 text-left hover:bg-accent/50 cursor-pointer"
                >
                  <span className="w-14 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                    {role}
                  </span>
                  <span
                    className={
                      "min-w-0 flex-1 truncate text-xs " +
                      (system ? "text-muted-foreground" : "text-foreground")
                    }
                    style={known ? { fontFamily: stack } : undefined}
                  >
                    {system ? "System default" : family}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemove(role)}
                  title={`Remove the ${role} face`}
                  aria-label={`Remove the ${role} face`}
                  className="size-6 shrink-0 grid place-items-center rounded-md text-muted-foreground/60 hover:text-destructive cursor-pointer"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            );
          })
        )}

        {naming ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valid) startBrowsing(trimmed);
                  if (e.key === "Escape") setNaming(false);
                }}
                placeholder="Role name"
                spellCheck={false}
                aria-label="New role name"
                className="h-7 flex-1 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => startBrowsing(trimmed)}
                disabled={!valid}
                aria-label="Choose a face"
                className="size-7 shrink-0 grid place-items-center rounded-md border border-input bg-background text-muted-foreground hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              >
                <Check size={13} />
              </button>
              <button
                type="button"
                onClick={() => setNaming(false)}
                aria-label="Cancel"
                className="size-7 shrink-0 grid place-items-center rounded-md text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X size={13} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {SUGGESTED_ROLES.filter((s) => !roles.includes(s.role)).map((s) => (
                <button
                  key={s.role}
                  type="button"
                  onClick={() => setDraft(s.role)}
                  className="rounded-full border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  {s.role}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground/80">
              {trimmed.length > 0 && !valid
                ? roles.includes(trimmed)
                  ? `"${trimmed}" is already declared`
                  : "Lowercase letters, digits and dashes — it becomes a utility name"
                : `Becomes --font-${trimmed || "role"} and the font-${trimmed || "role"} class`}
            </span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft("");
              setNaming(true);
            }}
            className="flex items-center justify-center gap-1 rounded-md border border-dashed py-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
          >
            <Plus size={12} /> Add a face
          </button>
        )}
      </div>

      <AlertDialog
        open={confirmRemove !== null}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Remove the "${confirmRemove}" face`}</AlertDialogTitle>
            <AlertDialogDescription>
              {`Anything using the font-${confirmRemove} class falls back to the inherited face. A typeset still pointing at this role will block the removal.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const role = confirmRemove;
                setConfirmRemove(null);
                if (role) send({ role, remove: true });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** The spec that puts a catalogue family on a role. */
export function assignSpec(role: string, font: CatalogFont): FontSpec {
  return {
    role,
    family: font.family,
    fallback: font.fallback,
    ...(font.google ? { google: font.google } : {}),
  };
}
