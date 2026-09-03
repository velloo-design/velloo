import type { Node, Theme } from "@velloo/schema";
import { DEFAULT_TYPESET_NAME } from "@velloo/schema/typeset";
import { type NodeTypography as Facts, nodeTypography } from "../../node-typography.ts";

interface Props {
  theme: Theme;
  /** Root of the screen the node lives on — the region walk needs the ancestry. */
  tree: Node;
  path: readonly number[];
  node: Node;
}

/**
 * What the selected node is set in, according to the theme — and what on the
 * node overrules it.
 *
 * Read-only on purpose. Every value here is derived: the rung comes from a prop,
 * the numbers come from the typeset's three controls, the face comes from a font
 * role. Offering to edit them at the node would mean writing the one-off
 * override this panel exists to make visible. The rows point at where the real
 * edit lives instead — the prop above, or the Theme tab.
 *
 * The override column reads the node's `className`, so it fills in on the
 * Tailwind channels. An `sx` / `style` folder still gets the theme side, which
 * is the half that was missing entirely.
 */
export function NodeTypographyReadout({ theme, tree, path, node }: Props) {
  const facts = nodeTypography(theme, tree, path, node);
  if (!facts) return null;

  const { resolved, overrides } = facts;
  return (
    <section className="flex flex-col gap-2">
      {/* "Typeset", not "Typography": the style editor below already owns a
          Typography group, and that one is the editable override surface while
          this is the theme's side of the same story. */}
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Typeset</div>

      <div className="rounded-md border bg-background">
        <div className="flex items-baseline gap-2 border-b px-2.5 py-2">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
            {facts.role}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">from {facts.via}</span>
        </div>

        <div className="flex flex-col px-2.5 py-1.5">
          <Row label="Size" value={`${resolved.fontSize}px`} override={overrides.size} />
          <Row
            label="Leading"
            value={resolved.lineHeight.toFixed(2)}
            override={overrides.leading}
          />
          <Row label="Tracking" value={resolved.letterSpacing} override={overrides.tracking} />
          <Row label="Weight" value={String(resolved.fontWeight)} override={overrides.weight} />
          <Row
            label="Face"
            value={faceLabel(facts)}
            override={overrides.family}
            mono={facts.face.role !== undefined}
          />
        </div>
      </div>

      {bypassesLadder(overrides) ? (
        <p className="text-[10px] leading-snug text-amber-600 dark:text-amber-500">
          Every rung property is overridden here, so this node ignores the theme's ladder — a rhythm
          change in the Theme tab won't move it.
        </p>
      ) : null}

      <p className="text-[10px] leading-snug text-muted-foreground">
        {regionSentence(facts)} Change the rhythm or the faces in the Theme tab — it moves every
        node on this rung at once.
      </p>

      {facts.responsive.length > 0 ? (
        <p className="text-[10px] leading-snug text-muted-foreground/80">
          Also <span className="font-mono text-foreground">{facts.responsive.join(" ")}</span> at
          wider breakpoints.
        </p>
      ) : null}
    </section>
  );
}

/**
 * True when the node restates every proportion the rung would have set.
 *
 * Worth saying out loud: the panel otherwise reads as "this is an h1 at 40px",
 * and the whole promise of the typeset is that re-rhythming the theme moves it.
 * A node in this state is opted out, and silence there is how a designer ends up
 * dragging a slider that can never affect what they're looking at.
 */
function bypassesLadder(overrides: Facts["overrides"]): boolean {
  return (["size", "leading", "tracking", "weight"] as const).every((p) => overrides[p]);
}

/**
 * The face as a role → family pair. The role is the useful half: it is what a
 * typeset points at and what `font-<role>` names, so the family is only shown to
 * confirm which one that currently resolves to.
 */
function faceLabel(facts: Facts): string {
  const { slot, role, stack } = facts.face;
  if (!role) return `inherited (${slot})`;
  const family = stack ? leadFamily(stack) : null;
  return family ? `${role} → ${family}` : role;
}

function leadFamily(stack: string): string {
  return /^\s*(?:"([^"]+)"|'([^']+)'|([^,]+))/.exec(stack)?.slice(1).find(Boolean)?.trim() ?? stack;
}

/**
 * Where the numbers came from, in the one sentence that makes them actionable.
 *
 * The typeset is the answer to "is this a node thing or a board thing" — it is
 * neither: it belongs to a *region*, set on an ancestor, resolved against the
 * board's theme. Saying which ancestor is what makes it findable.
 */
function regionSentence(facts: Facts): string {
  const { region } = facts;
  if (!region) return "Resolved against the default typeset — no typeset region wraps this node.";
  const how = region.via === "prose" ? "a Prose ancestor" : "a typeset class on an ancestor";
  const which = region.name === DEFAULT_TYPESET_NAME ? "default" : region.name;
  return `Resolved against the ${which} typeset, applied by ${how}.`;
}

function Row({
  label,
  value,
  override,
  mono,
}: {
  label: string;
  value: string;
  override?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="w-16 shrink-0 text-[10px] text-muted-foreground">{label}</span>
      {/* The theme's value stays visible when overridden rather than being
          replaced: knowing the rung says 40px is the point of the row, and the
          override is only meaningful next to what it displaced. */}
      <span
        title={value}
        className={
          override
            ? // Both halves have to fit a 320px rail, so neither gets to be
              // unbounded — the displaced value is capped rather than allowed
              // to squeeze the override that replaced it down to an ellipsis.
              "min-w-0 max-w-[45%] truncate font-mono text-[11px] text-muted-foreground/60 line-through"
            : `min-w-0 flex-1 truncate text-[11px] text-foreground${mono ? " font-mono" : ""}`
        }
      >
        {value}
      </span>
      {override ? (
        <span
          title={`${override} overrides the ${label.toLowerCase()} this rung would set`}
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground"
        >
          {override}
        </span>
      ) : null}
    </div>
  );
}
