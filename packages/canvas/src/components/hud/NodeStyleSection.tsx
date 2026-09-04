/**
 * The bar's controls again, all of them, in the side pane.
 *
 * The bar can only carry a handful before fields shrink to one legible digit,
 * so most controls are tiered to `pane`. Nothing is hidden by that — this
 * renders the whole resolved set, bar half included, so the pane is the
 * complete surface and the bar is the shortcut. Same widgets, same provenance,
 * so a value doesn't change meaning depending on where you edit it.
 */

import type { ComponentDescriptor } from "@velloo/provider";
import type { Node, Theme } from "@velloo/schema";
import { useCallback, useMemo } from "react";
import { useIconNames } from "../../hooks/useIconNames.ts";
import {
  type ControlSpec,
  colorChoices,
  fontChoices,
  resolveColorToken,
  resolveControls,
  type SnippetParams,
} from "../../hud/control-set.ts";
import { themeReadout } from "../../hud/theme-values.ts";
import type { ControlInput, WriteContext } from "../../hud/use-control-write.ts";
import { readControl } from "../../hud/values.ts";
import { pathFromString } from "../../path.ts";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { HudField } from "./fields.tsx";
import { Control } from "./NodeHud.tsx";

interface Props {
  node: Node;
  tree: Node | undefined;
  path: string;
  theme: Theme | null;
  descriptor: ComponentDescriptor | null;
  snippet: SnippetParams | null;
  /** Style controls write classes; a folder on `sx` or inline `style` keeps its own editor. */
  classChannel: boolean;
  onChange(spec: ControlSpec, next: ControlInput, ctx?: WriteContext): void;
}

export function NodeStyleSection({
  node,
  tree,
  path,
  theme,
  descriptor,
  snippet,
  classChannel,
  onChange,
}: Props) {
  const iconNames = useIconNames();
  const colors = useMemo(() => colorChoices(theme), [theme]);
  const fonts = useMemo(() => fontChoices(theme), [theme]);
  const resolveColor = useCallback(
    (token: string | null) => resolveColorToken(theme, token),
    [theme],
  );

  const controls = useMemo(() => {
    const all = resolveControls({ node, descriptor, snippet });
    return all.controls.filter(
      // `prompt` is the bar's stand-in for a dialog; the pane shows the real
      // image panel a few rows up, so a second opener would be a detour.
      (c) => c.kind !== "prompt" && (classChannel || c.slot.via !== "style"),
    );
  }, [node, descriptor, snippet, classChannel]);

  const readout = useMemo(
    () => themeReadout({ theme, tree, path: pathFromString(path), node }),
    [theme, tree, path, node],
  );

  if (controls.length === 0) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {controls.map((spec) => {
          const value = readControl(spec, {
            node,
            themeValues: readout.values,
            themeSource: readout.source,
          });
          // Colour and size want the row to themselves — a swatch plus a label,
          // or a mode plus a number, is already two controls wide.
          const wide = spec.kind === "color" || spec.kind === "size" || spec.kind === "prompt";
          return (
            <div key={spec.id} className={wide ? "col-span-2" : ""}>
              <HudField
                label={spec.label}
                origin={value.origin}
                themeValue={value.themeValue}
                source={value.source}
                width={0}
                note={readout.notes?.[spec.id]}
                onReset={value.origin === "changed" ? () => onChange(spec, null) : undefined}
              >
                <Control
                  spec={spec}
                  value={value}
                  colors={colors}
                  resolveColor={resolveColor}
                  fonts={fonts}
                  iconNames={iconNames}
                  measured={null}
                  onOpenPrompt={() => undefined}
                  onChange={(next, ctx) => onChange(spec, next, ctx)}
                />
              </HudField>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
