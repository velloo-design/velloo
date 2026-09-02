import type { Theme } from "@velloo/schema";
import {
  DEFAULT_TYPESET_NAME,
  resolveTypeset,
  type Typeset,
  typesetScale,
  typesetSizePx,
} from "@velloo/schema/typeset";
import { useEffect, useState } from "react";
import { type TypesetSpec, theme as themeApi } from "../../api.ts";
import { useCanvas } from "../../store.ts";
import { toastError } from "../../toast.ts";
import { MiniSelect } from "../style-editor/controls.tsx";
import { Separator } from "../ui/separator.tsx";
import { LadderReadout } from "./LadderReadout.tsx";
import { RhythmControl } from "./RhythmControl.tsx";
import { TypesetSwitcher } from "./TypesetSwitcher.tsx";

/** Slider bounds. Wide enough to be useful, narrow enough that every stop is a real design. */
const SIZE_RANGE = { min: 12, max: 24, step: 0.5 };
const LEADING_RANGE = { min: 1, max: 2.2, step: 0.05 };
const FLOW_RANGE = { min: 0.4, max: 2.5, step: 0.05 };

/** Sentinel for "this typeset names no face here" — distinct from any role name. */
const NO_FACE = "__none";

const FACES = [
  { field: "fontBody", label: "Body" },
  { field: "fontHeading", label: "Heading" },
  { field: "fontMono", label: "Mono" },
] as const;

function orderedNames(typesets: Record<string, Typeset>): string[] {
  const rest = Object.keys(typesets)
    .filter((n) => n !== DEFAULT_TYPESET_NAME)
    .sort();
  return [DEFAULT_TYPESET_NAME, ...rest];
}

/**
 * Theme-level typography: pick a typeset, drag its three rhythm controls, point
 * its faces at font roles, and read back the ladder they derive.
 *
 * Two things make this more than three sliders. Editing is inheritance-aware —
 * a preset stores only the controls it authors and follows `default` for the
 * rest, so every control shows which side it is on and can be handed back. And
 * dragging is optimistic: each tick paints a CSS-variable override into every
 * frame, and only the pointer-up commits, so the board re-rhythms continuously
 * without a round-trip or a reload per pixel.
 */
export function TypographySection({ theme }: { theme: Theme }) {
  const typesets = theme.typography.typesets ?? {};
  const names = orderedNames(typesets);
  const [wanted, setSelected] = useState(DEFAULT_TYPESET_NAME);
  const setTypesetDraft = useCanvas((s) => s.setTypesetDraft);
  const draft = useCanvas((s) => s.typesetDraft);
  const refreshTheme = useCanvas((s) => s.refreshTheme);

  // Derived rather than corrected in an effect, because the two directions
  // race: a preset just created here isn't in `names` until its theme refresh
  // lands, and one deleted by an agent in another tab vanishes without us
  // asking. Falling back for the tick in between beats fighting over state.
  const selected = names.includes(wanted) ? wanted : DEFAULT_TYPESET_NAME;

  // Clear any half-finished preview when the section unmounts mid-drag.
  useEffect(() => () => setTypesetDraft(null), [setTypesetDraft]);

  // Reading the draft back means the whole panel tracks a drag the way the
  // frames do: the thumb moves, the readouts count, the ladder re-derives, and
  // a control being dragged shows as authored the moment it is.
  const committed: Typeset = typesets[selected] ?? {};
  const authored: Typeset = draft?.name === selected ? draft.typeset : committed;
  const isBaseline = selected === DEFAULT_TYPESET_NAME;
  const base: Typeset = typesets[DEFAULT_TYPESET_NAME] ?? {};
  // What the region actually renders with: the preset's own controls over the
  // baseline's, with the built-in defaults underneath.
  const effective = resolveTypeset(isBaseline ? authored : { ...base, ...authored });

  const faceRoles = Object.keys(theme.typography.fontFamily ?? {}).sort();
  const basePx = typesetSizePx(effective.size);
  const scale = typesetScale(effective, { fontFamily: theme.typography.fontFamily ?? {} });

  const preview = (patch: Typeset) => {
    setTypesetDraft({ name: selected, typeset: { ...authored, ...patch } });
  };

  const send = (spec: TypesetSpec, onDone?: () => void) => {
    void themeApi
      .setTypeset([spec])
      .then(() => onDone?.())
      .catch((err) => {
        toastError(err, "Could not update the typeset");
        // Nothing changed on disk, so no theme-changed broadcast is coming to
        // reload the frames — and a rejected drag has left them painted with a
        // preview of a value that does not exist. Resync so it goes away.
        void refreshTheme();
      });
  };

  const commit = (spec: Omit<TypesetSpec, "name">) => send({ name: selected, ...spec });

  return (
    <div className="flex flex-col gap-3.5">
      <TypesetSwitcher
        names={names}
        selected={selected}
        onSelect={(name) => {
          setTypesetDraft(null);
          setSelected(name);
        }}
        // A new preset authors nothing: every control inherits from the
        // baseline until you move one, which is the whole point of the model.
        onAdd={(name) => send({ name }, () => setSelected(name))}
        onRename={(from, to) => send({ name: from, renameTo: to }, () => setSelected(to))}
        onRemove={(name) => send({ name, remove: true }, () => setSelected(DEFAULT_TYPESET_NAME))}
      />

      <RhythmControl
        label="Size"
        value={basePx}
        {...SIZE_RANGE}
        display={authored.size === undefined ? String(effective.size) : lengthLabel(authored.size)}
        authored={authored.size !== undefined}
        onClear={authored.size === undefined ? undefined : () => commit({ size: null })}
        hint={
          authored.size === undefined
            ? "1em follows the container — drag to pin it"
            : "pinned; clear to follow the container again"
        }
        onPreview={(px) => preview({ size: `${px}px` })}
        onCommit={(px) => commit({ size: `${px}px` })}
      />

      <RhythmControl
        label="Leading"
        value={effective.leading}
        {...LEADING_RANGE}
        display={effective.leading.toFixed(2)}
        authored={authored.leading !== undefined}
        onClear={authored.leading === undefined ? undefined : () => commit({ leading: null })}
        hint="body line-height — the whole ladder scales with it"
        onPreview={(n) => preview({ leading: n })}
        onCommit={(n) => commit({ leading: n })}
      />

      <RhythmControl
        label="Flow"
        value={typesetSizePx(effective.flow) / 16}
        {...FLOW_RANGE}
        display={lengthLabel(effective.flow)}
        authored={authored.flow !== undefined}
        onClear={authored.flow === undefined ? undefined : () => commit({ flow: null })}
        hint="space between blocks, and the air above a heading"
        onPreview={(em) => preview({ flow: `${round2(em)}em` })}
        onCommit={(em) => commit({ flow: `${round2(em)}em` })}
      />

      <Separator />

      <div className="flex flex-col gap-2">
        {FACES.map(({ field, label }) => (
          <FaceRow
            key={field}
            label={label}
            roles={faceRoles}
            value={authored[field]}
            inherited={isBaseline ? undefined : base[field]}
            onChange={(role) => commit({ [field]: role })}
          />
        ))}
        <p className="text-[10px] leading-relaxed text-muted-foreground/80">
          Roles, not stacks — they point at the fonts you declared, so swapping a face updates every
          typeset that names it.
        </p>
      </div>

      <Separator />

      <LadderReadout scale={scale} rootPx={basePx} />
    </div>
  );
}

function FaceRow({
  label,
  roles,
  value,
  inherited,
  onChange,
}: {
  label: string;
  roles: string[];
  value: string | undefined;
  /** The baseline's role for this face, when editing a preset. */
  inherited: string | undefined;
  onChange: (role: string | null) => void;
}) {
  const isAuthored = value !== undefined;
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: MiniSelect renders the select this label wraps
    <label className="flex items-center gap-1.5">
      <span
        aria-hidden
        className={
          "size-1.5 shrink-0 rounded-full " +
          (isAuthored ? "bg-primary" : "border border-muted-foreground/40")
        }
      />
      <span className="w-14 shrink-0 text-xs text-muted-foreground">{label}</span>
      <MiniSelect
        value={value ?? NO_FACE}
        onChange={(next) => onChange(next === NO_FACE ? null : next)}
        options={[
          [NO_FACE, inherited ? `${inherited} (inherited)` : "—"],
          ...roles.map((role): [string, string] => [role, role]),
        ]}
        className="flex-1 min-w-0"
      />
    </label>
  );
}

/** A bare number on disk means px, matching how the theme reads every other length. */
function lengthLabel(value: string | number): string {
  return typeof value === "number" ? `${value}px` : value;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
